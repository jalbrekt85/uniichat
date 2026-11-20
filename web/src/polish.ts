// The small details: tooltips, list choreography, sound, keyboard search.
// Libraries: @floating-ui/dom.
import { arrow, computePosition, flip, offset, shift } from "@floating-ui/dom";

// ---------------------------------------------------------------------------
// Sound: a tiny Web Audio voice. Soft attacks, long releases, a low-pass,
// gentle compression and a short dark room; every sound tails into silence.

type Sound = "open" | "send" | "recv" | "ok" | "err";

let enabled = true;
try { enabled = localStorage.getItem("unii.sound") !== "0"; } catch {}

let audio_ctx: AudioContext | null = null;
let audio_bus: GainNode | null = null;

function engine(): { ctx: AudioContext; bus: GainNode } | null {
  if (audio_ctx === null) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (Ctx === undefined) return null;
    const ctx: AudioContext = new Ctx();
    const bus = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.35;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.3;
    const master = ctx.createGain();
    master.gain.value = 0.12;
    const room = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.4) * 0.45;
      }
    }
    room.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.24;
    const dry = ctx.createGain();
    dry.gain.value = 0.95;
    bus.connect(filter);
    filter.connect(dry).connect(master);
    filter.connect(room).connect(wet).connect(master);
    master.connect(compressor).connect(ctx.destination);
    audio_ctx = ctx;
    audio_bus = bus;
  }
  if (audio_ctx.state === "suspended") {
    void audio_ctx.resume();
  }
  return audio_bus === null ? null : { ctx: audio_ctx, bus: audio_bus };
}

function tone(ctx: AudioContext, dest: AudioNode, hz: number, at: number, dur: number, gain: number, type: OscillatorType = "sine"): void {
  const osc = ctx.createOscillator();
  const soft = ctx.createBiquadFilter();
  const env = ctx.createGain();
  soft.type = "lowpass";
  soft.frequency.value = 2000;
  soft.Q.value = 0.2;
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + Math.min(0.07, dur * 0.32));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(soft).connect(env).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.1);
}

export function playSound(name: Sound): void {
  if (!enabled) return;
  const engine_audio = engine();
  if (engine_audio === null) return;
  const { ctx, bus } = engine_audio;
  const t = ctx.currentTime + 0.02;
  try {
    switch (name) {
      case "open":
        tone(ctx, bus, 392, t, 0.46, 0.045);
        tone(ctx, bus, 587.33, t + 0.035, 0.54, 0.035);
        break;
      case "send":
        tone(ctx, bus, 440, t, 0.4, 0.05);
        tone(ctx, bus, 659.25, t + 0.05, 0.46, 0.04);
        break;
      case "recv":
        tone(ctx, bus, 783.99, t, 0.54, 0.04);
        tone(ctx, bus, 1046.5, t + 0.06, 0.6, 0.026);
        break;
      case "ok":
        tone(ctx, bus, 523.25, t, 0.64, 0.04);
        tone(ctx, bus, 659.25, t + 0.04, 0.66, 0.035);
        tone(ctx, bus, 783.99, t + 0.08, 0.7, 0.03);
        break;
      case "err":
        tone(ctx, bus, 220, t, 0.5, 0.04, "triangle");
        tone(ctx, bus, 174.61, t + 0.08, 0.55, 0.03);
        break;
    }
  } catch {}
}

export function soundEnabled(): boolean { return enabled; }

function syncSoundButton(el: HTMLElement): void {
  el.setAttribute("aria-pressed", String(enabled));
  if (el.dataset.sound === "icon") {
    el.classList.toggle("on", enabled);
    el.setAttribute("aria-label", enabled ? "Mute sound effects" : "Enable sound effects");
  } else {
    el.textContent = enabled ? "Sound effects · on" : "Sound effects · off";
  }
}

export function setSound(on: boolean): void {
  enabled = on;
  try { localStorage.setItem("unii.sound", on ? "1" : "0"); } catch {}
  document.querySelectorAll<HTMLElement>("[data-sound]").forEach(syncSoundButton);
  if (on) playSound("open");
}

function initSound(): void {
  const buttons = document.querySelectorAll<HTMLElement>("[data-sound]");
  buttons.forEach((button) => {
    syncSoundButton(button);
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setSound(!enabled);
    });
  });
}

// ---------------------------------------------------------------------------
// Tooltips: floating-ui, delayed first, immediate peers, keyboard + pointer

let tip: HTMLDivElement | null = null;
let tipText: HTMLSpanElement | null = null;
let tipArrow: HTMLElement | null = null;
let active: HTMLElement | null = null;
let described: string | null = null;
let timer = 0;
let lastAt = 0;
let seq = 0;

function scope(el: HTMLElement): boolean {
  return el.closest("header, #chats, footer, #workdir, #archived, #menu, #wallet, #import, #risk") !== null
    && el.closest(".gallery") === null;
}

function tipFor(el: HTMLElement): string {
  if (!scope(el) || !el.matches("button, [role='button'], a")) return "";
  const title = el.getAttribute("title") ?? "";
  if (title !== "") {
    el.removeAttribute("title");
    el.dataset.tip = title;
  }
  const text = (el.textContent ?? "").trim();
  const special = el.classList.contains("copy") || el.classList.contains("archive") || el.classList.contains("work-plus") || el.classList.contains("menu") || el.classList.contains("chats-toggle") || el.classList.contains("send") || el.classList.contains("attach") || el.classList.contains("mic") || el.classList.contains("chats-close") || el.classList.contains("archived-close") || el.classList.contains("work-new") || el.hasAttribute("data-pick-up") || el.hasAttribute("data-pick-home");
  if (text !== "" && !special) return "";
  return el.dataset.tip ?? el.getAttribute("aria-label") ?? "";
}

function hideTip(): void {
  window.clearTimeout(timer);
  timer = 0;
  seq++;
  if (active !== null) {
    if (described === null) active.removeAttribute("aria-describedby");
    else active.setAttribute("aria-describedby", described);
  }
  active = null;
  described = null;
  if (tip !== null) tip.dataset.open = "0";
}

async function showTip(target: HTMLElement): Promise<void> {
  const label = tipFor(target);
  if (label === "" || tip === null || tipText === null || tipArrow === null) return;
  const mine = ++seq;
  active = target;
  described = target.getAttribute("aria-describedby");
  tipText.textContent = label;
  tip.dataset.open = "1";
  target.setAttribute("aria-describedby", "tip");
  const pos = await computePosition(target, tip, {
    placement: "bottom",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 10 }), shift({ padding: 10 }), arrow({ element: tipArrow })],
  });
  if (mine !== seq || active !== target) return;
  lastAt = Date.now();
  tip.style.left = pos.x + "px";
  tip.style.top = pos.y + "px";
  const a = pos.middlewareData.arrow;
  const side = pos.placement.split("-")[0];
  tipArrow.dataset.side = side;
  Object.assign(tipArrow.style, {
    left: a?.x != null ? a.x + "px" : "",
    top: a?.y != null ? a.y + "px" : "",
    right: "",
    bottom: "",
  });
}

function schedule(target: HTMLElement): void {
  if (matchMedia("(pointer: coarse)").matches) return;
  const label = target.dataset.tip ?? target.getAttribute("title") ?? target.getAttribute("aria-label") ?? "";
  if (label === "" || active === target) return;
  hideTip();
  timer = window.setTimeout(() => { void showTip(target); }, Date.now() - lastAt < 900 ? 40 : 420);
}

function initTooltips(): void {
  if (matchMedia("(pointer: coarse)").matches) return;
  tip = document.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "tooltip");
  tip.dataset.open = "0";
  tip.innerHTML = '<span></span><i></i>';
  document.body.append(tip);
  tipText = tip.querySelector("span");
  tipArrow = tip.querySelector("i");

  document.addEventListener("pointerover", (ev) => {
    if (ev.pointerType !== "mouse") return;
    const target = (ev.target as HTMLElement)?.closest<HTMLElement>("button, [role='button'], a");
    if (target === null || target === undefined) return;
    schedule(target);
  });
  document.addEventListener("pointerout", (ev) => {
    const to = ev.relatedTarget as HTMLElement | null;
    if (active !== null && to !== null && active.contains(to)) return;
    hideTip();
  });
  document.addEventListener("focusin", (ev) => {
    if (!(ev.target instanceof HTMLElement)) return;
    const target = ev.target.closest<HTMLElement>("button, [role='button'], a");
    if (target !== null) schedule(target);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("click", hideTip);
  document.addEventListener("scroll", hideTip, true);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Keyboard

function typing(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.matches("input, textarea, select") || el.isContentEditable);
}

function initKeys(): void {
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented) return;
    if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !typing(ev.target)) {
      const search = document.querySelector<HTMLInputElement>(".chats-search input");
      if (search !== null) {
        ev.preventDefault();
        if (matchMedia("(max-width: 900px)").matches) {
          document.body.classList.add("chats-open");
        }
        search.focus();
        search.select();
      }
      return;
    }
    if (ev.key === "Escape" && document.activeElement instanceof HTMLInputElement && document.activeElement.matches(".chats-search input")) {
      const input = document.activeElement;
      if (input.value !== "") {
        ev.preventDefault();
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        input.blur();
      }
    }
  });
}

// ---------------------------------------------------------------------------

export function initPolish(): void {
  initTooltips();
  initSound();
  initKeys();
}
