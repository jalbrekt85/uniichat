// UniiChat (the site)
// ===================
// The page around View.ts's chat: the server's messages go to
// View.view_hear, a click's `data-act` (Html.ts) to View.view_act, and
// both answer what to send back. The page is drawn once a frame, keeping
// the first row in sight in place, or the bottom while the page is at it;
// the log's rows only once a message (but a stream's piece) or an act
// changed them, what streams in a place of its own, so typing, or a reply
// streaming, touches no row.
// The markup is index.html's: the header, the chat or the account page
// (/account), and the footer as the terminal's. A tab is no device; a
// signed-out one gets the chat offline (Guest). In the iOS app (ios/),
// credit is bought through the App Store (APP), and sign-in is by email
// only (another company's would need Sign in with Apple).

import * as Import from "../../Import.ts";
import { theme_css } from "../../Theme.ts";
import * as View from "../../View.ts";
import { BOT_LIFE_MS, BOT_PALETTE } from "../../Bot.ts";
import tippy, { type Instance } from "tippy.js";
import * as Html from "./Html.ts";
import { mountShell, setPendingPics, setShell } from "./fx-react";
import { initPolish, playSound, setSound, soundEnabled } from "./polish";
import { highlightCode } from "./code";
import { SKULL_SEED, type SkullNode, type SkullTree } from "./neural";

// Types
// =====

// a source the import read (a folder, an export): its sessions, and its
// files left out as they changed while read
type Read = { sessions: Import.Session[]; moved: number };

// Constants
// =========

// the iOS app's bridge (ios/), in its web view only
const APP = (window as any).webkit?.messageHandlers?.unii ?? null;

// a page with a hover has a keyboard of its own; on a touch screen,
// Enter types a new line (the arrow sends), and the page never focuses
// the box itself, which would pop the keyboard up
const DESK = matchMedia("(hover: hover)");

// what a guest is told after the hello but its ask (View.ask): the ask
// again (a link expired), the link sent
const EXPIRED = "That sign-in link expired. What's your email? I'll send you a new one.";
// the line under a guest's box, where the server bills: signing in is
// the consent (Billing.ts CONSENT says it in full); its links open a tab,
// as the menu's do, so the chat stays
const GUEST_AI = 'By signing in, you accept the <a href="/terms.html" target="_blank">terms</a> and <a href="/privacy.html" target="_blank">privacy policy</a>, and that Anthropic\'s and OpenAI\'s models answer you.';
const SENT    = (email: string) => `Thanks! I sent a link to ${email}. Open it, and we'll go on from here.`;

// a folder without sessions
const NONE   = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";
const PAYING = "Waiting for your payment in the new tab…";

// an import's payment, its tab back from checkout (?paid=tab), tells the
// import's tab at once (a hidden tab's timers may wait a minute)
const PAID = new BroadcastChannel("unii.paid");

// the intro's scenes: two lines, then the logo above the name
const SCENES = `
  <div class="scene"><p>Your entire life.</p><p>Chats that never end.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;

// the chat
const v = View.view_new();

// the message box
const BOX = $<HTMLTextAreaElement>("textarea");

// the import's slider: the first day it takes, in days since 1970, from
// the first new message's (its left end: all) to today's
const BACK = $<HTMLInputElement>("#import [name=back]");

// the page's: end: at its bottom; stick: the next draw may keep it;
// frame: awaited (0: none); rows: the log's rows changed, to draw;
// found: the sources read, by name; done: sessions imported before; off:
// left out (Import.Want); step: the import's
const P = {
  id    : "",
  session: "",
  guest : false,
  imgs  : [] as Blob[],
  rec   : null as MediaRecorder | null,
  shown : "",
  sessionShown: "__unset",
  loaded: false,
  end   : true,
  stick : true,
  frame : 0,
  rows  : true,
  bottom: 0,
  user  : 0,
  y     : 0,
  away  : 0,
  toast : 0,
  found : new Map<string, Read>(),
  done  : {} as Import.Done,
  off   : new Set<string>(),
  step  : "" as "" | "start" | "pay" | "send" | "run" | "seen" | "done",
  dir   : null as { path: string; parent: string | null; home: string; dirs: Array<{ name: string; path: string }> } | null,
};

// a session change must land on its latest message, not a restored offset
if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

// where this browser keeps a fact of the account signed in, so another
// account on it starts anew: "draft", the box's text, for the tab (a
// reload or a top-up's trip to Stripe keeps it); "risked", the risk
// accepted. (The import welcome is per account, not per chat: see below.)
function kept(fact: string): string {
  return "unii." + fact + "." + P.id + "." + (P.session === "" ? "default" : P.session);
}

// the rail is part of the page, and the page reloads when a chat is opened;
// keep the last list in the tab so it never paints empty while the socket
// reconnects (the server's state replaces it as soon as it arrives)
function sessions_key(): string {
  return "unii.sessions." + P.id;
}

function save_sessions(): void {
  if (P.id === "") {
    return;
  }
  try {
    sessionStorage.setItem(sessions_key(), JSON.stringify({ sessions: v.sessions, works: v.works }));
  } catch {}
}

function restore_sessions(): void {
  if (P.id === "") {
    return;
  }
  try {
    const kept = JSON.parse(sessionStorage.getItem(sessions_key()) ?? "null");
    if (kept !== null && Array.isArray(kept.sessions)) {
      v.sessions = kept.sessions;
    }
    if (kept !== null && Array.isArray(kept.works)) {
      v.works = kept.works;
    }
  } catch {}
}

// Boot
// ====

async function boot(): Promise<void> {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  const q = new URLSearchParams(location.search);
  const want = q.get("session") === "default" ? "" : (q.get("session") ?? "");
  // a chat's id stays in the address, so a reload, a copied link and the
  // back button all return to the same chat
  const path = location.pathname === "/account" ? "/account" : "/";
  history.replaceState(null, "", path + (want === "" ? "" : "?session=" + encodeURIComponent(want)));
  if (q.has("terminal")) {
    solo("Your terminal is signed in.", "You can close this tab and go back to it.");
    return;
  }
  if (q.has("deleted")) {
    solo("Your account was deleted.", `Your chat and Unii's memory are erased. <a href="/">Back to UniiChat</a>`);
    return;
  }
  if (q.get("paid") === "tab") {
    PAID.postMessage(true);
    close();
    solo("Payment received.", "Close this tab: your import starts in the UniiChat tab you came from.");
    return;
  }
  const me = await boot_me();
  P.guest = me === null;
  chat();
  if (me === null) {
    history.replaceState(null, "", "/");
    guest(q.has("expired"));
    return;
  }
  P.id = me.id;
  restore_sessions();
  P.session = want;
  v.session = want;
  signed();
  route();
  v.bills = me.bills;
  v.credits = me.credits;
  mountShell();
  initPolish();
  initPalette();
  reset_ctx();
  init_thought();
  connect();
  if (q.has("paid")) {
    toast("Payment received. Your credit shows up in a moment.");
  }
}

// the account signed in (null: none, as the server refuses the session);
// any other answer (a network past its limit, a deploy, no connection)
// says nothing of who, so it is asked again
async function boot_me(): Promise<any> {
  for (;;) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      return res.ok ? res.json() : null;
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

// a page of one note: the terminal signed in, the account deleted
function solo(title: string, sub: string): void {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}

// Guest
// =====
// UniiChat's hello, ending in its ask for an email; the answers come from
// here, by no AI: an email gets the sign-in link, "@name" goes to
// GitHub, anything else gets the server's why. All in v.live (unlogged).

// a guest's tab, shown or hidden once signed in elsewhere (the link opens
// a new tab), becomes the user's
async function guest(expired: boolean): Promise<void> {
  document.onvisibilitychange = async () => {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.ok) {
      location.reload();
    }
  };
  const { hello, bills, github } = await fetch("/api/hello").then((res) => res.json());
  const ask = github && APP === null;
  document.body.classList.toggle("bills", bills);
  $(".ai").innerHTML = bills ? GUEST_AI : "";
  BOX.placeholder = "Enter your email" + (ask ? " or @github" : "");
  // only the sign-in box is an email field; a signed-in chat box must
  // never be classified as one by browser autofill
  BOX.inputMode = "email";
  BOX.setAttribute("autocomplete", "email");
  BOX.setAttribute("enterkeyhint", "send");
  BOX.setAttribute("autocapitalize", "none");
  BOX.spellcheck = false;
  // read from its start: on a phone it is taller than the screen
  P.end = false;
  guest_say(hello + "\n\n" + (expired ? EXPIRED : View.email_ask(ask)));
}

async function guest_send(text: string): Promise<void> {
  P.end = true;
  v.live.push({ kind: "user", text });
  draw(true);
  const res = await View.post("/api/login", { who: text });
  if (res.url) {
    location.href = res.url;
    return;
  }
  guest_say(res.error ?? SENT(res.who));
}

function guest_say(text: string): void {
  v.live.push({ kind: "unii", text });
  draw(true);
}

// Chat
// ====

let rail_query = "";

function chat(): void {
  const file = $<HTMLInputElement>("input[type=file]");
  const search = $<HTMLInputElement>(".chats-search input");
  if (search !== null) {
    search.oninput = () => {
      rail_query = search.value.trim().toLowerCase();
      draw(false);
    };
  }
  BOX.oninput = () => {
    if (!P.guest) {
      sessionStorage.setItem(kept("draft"), BOX.value);
    }
    BOX.style.height = "auto";
    BOX.style.height = Math.min(BOX.scrollHeight, innerHeight * 0.4) + "px";
    draw(true);
  };
  // a guest's answer, an email, is one line: Enter sends it everywhere;
  // never the Enter that ends a composition (Japanese, Chinese: Safari
  // ends it first, so only its keyCode, 229, says so)
  BOX.onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && (DESK.matches || P.guest)) {
      ev.preventDefault();
      submit();
    }
  };
  BOX.onpaste = (ev) => attach([...(ev.clipboardData?.files ?? [])]);
  $("form").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $(".attach").onclick = () => file.click();
  $("#menu .out").onclick = signout;
  $("#menu .setup").onclick = () => {
    $("#menu").hidePopover();
    location.href = "/setup";
  };
  $("#chats .new").onclick = () => void new_chat();
  $("#chats .chats-close").onclick = chats_close;
  $("#chats-veil").onclick = chats_close;
  const toggle = $(".chats-toggle");
  toggle.onclick = () => {
    const open = document.body.classList.toggle("chats-open");
    toggle.setAttribute("aria-expanded", String(open));
  };
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...(file.files ?? [])]);
    file.value = "";
  };
  $("#wallet").insertAdjacentHTML("beforeend", Html.credit_html(APP !== null));
  onpopstate = route;
  importer();
  initConfirm();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    attach([...(ev.dataTransfer?.files ?? [])]);
  };
  document.onclick = click;
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target as HTMLElement).classList?.contains("pick-path")) {
      ev.preventDefault();
      void work_load((ev.target as HTMLInputElement).value);
      return;
    }
    if (ev.key !== "Enter" && ev.key !== " ") {
      return;
    }
    const arc = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-archive]");
    if (arc === null || arc === undefined) {
      return;
    }
    ev.preventDefault();
    archive_chat(arc.dataset.archive ?? "", arc.dataset.on === "1");
  });
  // a phone's keyboard up or down: the bottom stays in sight, if at it
  visualViewport!.onresize = () => draw(true);
  document.onscroll = () => jump_update();
  // a reader's own scroll is not the page's: a wheel, a touch, a key or a
  // scrollbar drag is what leaves the bottom, not the reply growing
  for (const ev of ["wheel", "touchstart", "touchmove", "keydown", "mousedown"]) {
    addEventListener(ev, () => (P.user = performance.now()), { passive: true });
  }
  $("#jump").onclick = () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    P.end = true;
    P.away = 0;
    $("#jump").hidden = true;
  };
  // A neuron click asks the server for exactly that range: one zoom, which
  // answers with its two halves. The next click asks again. Loading one layer
  // per click is what keeps a tree of any size explorable without a cap.
  addEventListener("unii:skull-load", (ev) => {
    const detail = (ev as CustomEvent<{ id?: unknown; n?: unknown }>).detail;
    const id = Number(detail?.id);
    const n = Number(detail?.n);
    if (!Number.isInteger(id) || !Number.isInteger(n) || n < 2) return;
    tree_open.add(id + "+" + n);
    View.link_send(v, { $: "zoom", part: [id, n] }, () => {});
  });
  initChatWidth();
  draw(true);
}

// A scroll the page does itself is not the reader leaving the bottom: a
// content growth while it is being placed must not flip "Latest" on (and
// stop the next draw from following the new bottom).
function to_bottom(): void {
  P.bottom = performance.now();
  scrollTo(0, document.documentElement.scrollHeight);
}

// "Latest" appears whenever the reader is above the bottom of the chat;
// opening a palette or the account hides it.
function jump_update(): void {
  const jump = document.getElementById("jump");
  if (jump === null) {
    return;
  }
  const recent = performance.now() - P.bottom < 160;
  const user = performance.now() - P.user < 400;
  const near = innerHeight + scrollY >= document.documentElement.scrollHeight - 24;
  // a scroll up (a scrollbar drag too, which fires no wheel) leaves the
  // bottom; the page's own scroll down never does
  const dy = P.y - scrollY;
  const up = dy > 2;
  P.y = scrollY;
  // how far the reader has gone from the bottom, so a nudge does not
  // offer "Latest": about two seconds of steady scrolling must pass first
  if (near) {
    P.away = 0;
  } else if (dy > 0) {
    P.away += dy;
  } else {
    P.away = Math.max(0, P.away + dy);
  }
  const far = !near && P.away >= Math.max(800, innerHeight * 1.5);
  // a reader who scrolled up stays where they are, however much has
  // streamed since: only the page's own scroll to the bottom gets the grace
  const at = near || (!user && !up && recent);
  P.end = at;
  const hidden = !far || document.body.classList.contains("account") || $("#palette").hidden === false || document.querySelector(".gallery") !== null;
  jump.hidden = hidden;
}

// Reading column width
// ====================
// The chat column can be dragged at either edge. Width is remembered per
// browser; the text scales a little with it so a wider column reads bigger
// instead of just longer. The mobile layout is always full width.

function initChatWidth(): void {
  const root = document.documentElement;
  const handles = [...document.querySelectorAll<HTMLElement>(".col-resize")];
  if (handles.length === 0) return;
  const saved = Number(localStorage.getItem("unii.col") ?? "760");
  let width = Number.isFinite(saved) && saved > 0 ? saved : 760;

  const limits = (): { min: number; max: number } => {
    const rail = parseFloat(getComputedStyle(root).getPropertyValue("--rail")) || 292;
    const skull = parseFloat(getComputedStyle(root).getPropertyValue("--skull")) || 0;
    const max = Math.max(600, Math.min(1280, innerWidth - rail - skull - 44));
    return { min: Math.min(600, max), max };
  };
  const save = (): void => {
    try { localStorage.setItem("unii.col", String(width)); } catch {}
  };
  const apply = (next: number, persist = false): void => {
    if (innerWidth <= 900) {
      root.style.removeProperty("--col");
      root.style.setProperty("--msg-size", "15px");
      handles.forEach((handle) => {
        handle.setAttribute("aria-valuenow", String(Math.round(next)));
        handle.dataset.size = String(Math.round(next));
      });
      return;
    }
    const { min, max } = limits();
    width = Math.round(Math.min(max, Math.max(min, next)));
    root.style.setProperty("--col", width + "px");
    // Nearly constant type: dragging the column should mostly change line
    // length, not make the reading size balloon (max +0.3px).
    const size = Math.min(16.8, Math.max(16.5, 16.5 + Math.max(0, width - 700) / 1600));
    root.style.setProperty("--msg-size", size.toFixed(2) + "px");
    handles.forEach((handle) => {
      handle.setAttribute("aria-valuenow", String(width));
      handle.setAttribute("aria-valuemin", String(min));
      handle.setAttribute("aria-valuemax", String(max));
      handle.dataset.size = String(width);
    });
    if (persist) save();
  };

  apply(width);
  handles.forEach((handle) => {
    const side = handle.id === "col-left" ? -1 : 1;
    let drag: { x: number; width: number } | null = null;
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || innerWidth <= 900) return;
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, width };
      handle.classList.add("dragging");
      document.body.classList.add("resizing");
    });
    handle.addEventListener("pointermove", (ev) => {
      if (drag === null) return;
      apply(drag.width + side * (ev.clientX - drag.x) * 2);
    });
    const end = (): void => {
      if (drag === null) return;
      drag = null;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      save();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    handle.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight") { ev.preventDefault(); apply(width + 24, true); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); apply(width - 24, true); }
      else if (ev.key === "Home") { ev.preventDefault(); apply(760, true); }
    });
    handle.addEventListener("dblclick", () => apply(760, true));
  });
  addEventListener("resize", () => apply(width));
}

// Command palette
// ===============
// Cmd/Ctrl+K or the menu's Jump to…: every chat and the shell's actions,
// filtered as you type. The pointer and the keyboard both work.

type PaletteItem = { group: "Actions" | "Chats"; label: string; detail: string; icon: string; kbd: string; search: string; run: () => void };

let paletteItems: PaletteItem[] = [];
let paletteIndex = 0;
let paletteQuery = "";
let paletteOpen = false;
let paletteReturn: HTMLElement | null = null;

function work_base(work: string): string {
  const parts = work.split("/").filter((part) => part !== "");
  return parts.length === 0 ? "/" : parts[parts.length - 1];
}

function palette_actions(): PaletteItem[] {
  const actions: PaletteItem[] = [
    { group: "Actions", label: "New chat", detail: "Start a fresh chat in this workspace", icon: "+", kbd: "N", search: "new chat start create", run: () => void new_chat() },
    { group: "Actions", label: "Jump to a chat", detail: "Search chats by title or workspace", icon: "⌕", kbd: "/", search: "search chats find jump", run: () => {
      const search = $<HTMLInputElement>(".chats-search input");
      if (matchMedia("(max-width: 900px)").matches) {
        document.body.classList.add("chats-open");
        $(".chats-toggle").setAttribute("aria-expanded", "true");
      }
      search.focus();
      search.select();
    } },
    { group: "Actions", label: "Open account", detail: "Balance, usage and data", icon: "$", kbd: "A", search: "account billing credit usage", run: () => go("/account") },
    { group: "Actions", label: "Archived chats", detail: "Restore a hidden chat", icon: "▣", kbd: "R", search: "archive restore hidden", run: () => $("#archived").showPopover() },
    { group: "Actions", label: "Import history", detail: "Bring past Claude and ChatGPT chats", icon: "⇩", kbd: "I", search: "import history claude chatgpt", run: () => void import_open(false) },
    { group: "Actions", label: soundEnabled() ? "Mute sound effects" : "Enable sound effects", detail: "Interface tones for sends, replies and actions", icon: "♪", kbd: "S", search: "sound audio mute effects", run: () => setSound(!soundEnabled()) },
    { group: "Actions", label: "Focus message box", detail: "Start typing where you left off", icon: "↵", kbd: "⏎", search: "composer message input focus", run: () => BOX.focus() },
  ];
  if (v.page === null) {
    actions.push({ group: "Actions", label: v.fold === null ? "Fold the whole chat" : "Unfold the whole chat", detail: v.fold === null ? "Condense the chat into its blocks" : "Show every message whole", icon: "◫", kbd: "F", search: "fold unfold collapse expand", run: () => act({ $: "Fold", on: v.fold === null }) });
  }
  return actions;
}

function palette_chats(): PaletteItem[] {
  return v.sessions
    .filter((chat) => !chat.archived)
    .slice()
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .map((chat) => {
      const title = chat.title.trim() === "" ? "New chat" : chat.title;
      return {
        group: "Chats" as const,
        label: title,
        detail: work_base(chat.work) + " · " + chat.messages + (chat.messages === 1 ? " message" : " messages"),
        icon: "↗",
        kbd: "",
        search: (title + " " + chat.work).toLowerCase(),
        run: () => {
          playSound("open");
          leaving(() => switch_session(chat.id));
        },
      };
    });
}

function palette_match(item: PaletteItem, query: string): boolean {
  if (query === "") return true;
  return (item.label + " " + item.detail + " " + item.search).toLowerCase().includes(query);
}

function render_palette(): void {
  if (!paletteOpen) return;
  const input = $<HTMLInputElement>("#palette-input");
  const list = $("#palette-list");
  const query = paletteQuery.trim().toLowerCase();
  const actions = palette_actions().filter((item) => palette_match(item, query));
  const chats = palette_chats().filter((item) => palette_match(item, query)).slice(0, query === "" ? 7 : 12);
  paletteItems = [...actions, ...chats];
  if (paletteIndex >= paletteItems.length) paletteIndex = Math.max(0, paletteItems.length - 1);
  if (paletteItems.length === 0) {
    list.innerHTML = `<p class="palette-empty">No chats or actions match <b>${Html.esc(query)}</b>.</p>`;
    input.setAttribute("aria-activedescendant", "");
    return;
  }
  let html = "";
  let group = "";
  paletteItems.forEach((item, i) => {
    if (item.group !== group) {
      group = item.group;
      html += `<div class="palette-group" role="presentation">${group}</div>`;
    }
    html += `<button type="button" class="palette-item" role="option" id="palette-item-${i}" data-palette-index="${i}" aria-selected="${i === paletteIndex}"><span class="p-ico" aria-hidden="true">${Html.esc(item.icon)}</span><span class="p-text"><b>${Html.esc(item.label)}</b><small>${Html.esc(item.detail)}</small></span>${item.kbd === "" ? "" : `<kbd>${Html.esc(item.kbd)}</kbd>`}</button>`;
  });
  list.innerHTML = html;
  input.setAttribute("aria-activedescendant", "palette-item-" + paletteIndex);
  const active = list.querySelector<HTMLElement>(`[data-palette-index="${paletteIndex}"]`);
  active?.scrollIntoView({ block: "nearest" });
}

function palette_move(delta: number): void {
  if (paletteItems.length === 0) return;
  paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
  render_palette();
}

function palette_choose(index: number): void {
  const item = paletteItems[index];
  close_palette();
  item?.run();
}

function refreshPalette(): void {
  if (paletteOpen) render_palette();
}

function open_palette(): void {
  if (paletteOpen) return;
  paletteOpen = true;
  paletteReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteQuery = "";
  paletteIndex = 0;
  const el = $("#palette");
  el.hidden = false;
  document.body.classList.add("palette-open");
  const input = $<HTMLInputElement>("#palette-input");
  input.value = "";
  render_palette();
  requestAnimationFrame(() => input.focus());
  jump_update();
  playSound("open");
}

function close_palette(): void {
  if (!paletteOpen) return;
  paletteOpen = false;
  $("#palette").hidden = true;
  document.body.classList.remove("palette-open");
  paletteReturn?.focus();
  paletteReturn = null;
  jump_update();
}

function initPalette(): void {
  const input = $<HTMLInputElement>("#palette-input");
  input.oninput = () => {
    paletteQuery = input.value;
    paletteIndex = 0;
    render_palette();
  };
  input.onkeydown = (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); palette_move(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); palette_move(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); palette_choose(paletteIndex); }
    else if (ev.key === "Escape") { ev.preventDefault(); close_palette(); }
  };
  $("#palette-list").onclick = (ev) => {
    const item = (ev.target as HTMLElement).closest<HTMLElement>("[data-palette-index]");
    if (item === null) return;
    palette_choose(Number(item.dataset.paletteIndex));
  };
  $("#palette .palette-backdrop").onclick = () => close_palette();
  $("#menu .palette-open").onclick = () => {
    $("#menu").hidePopover();
    open_palette();
  };
  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      paletteOpen ? close_palette() : open_palette();
    } else if (ev.key === "Escape" && paletteOpen) {
      ev.preventDefault();
      close_palette();
    }
  });
}

// the page of a user signed in, out of the guest's
function signed(): void {
  document.body.className = "";
  BOX.placeholder = View.HINT;
  BOX.removeAttribute("inputmode");
  BOX.removeAttribute("enterkeyhint");
  BOX.setAttribute("autocomplete", "off");
  BOX.setAttribute("autocapitalize", "sentences");
  BOX.spellcheck = true;
  BOX.value = sessionStorage.getItem(kept("draft")) ?? "";
  BOX.dispatchEvent(new Event("input"));
  const welcomeNew = $<HTMLButtonElement>(".welcome-new");
  if (welcomeNew !== null) {
    welcomeNew.onclick = () => { void new_chat(); };
  }
}

function submit(): void {
  const text = BOX.value.trim();
  if (text !== "" || P.imgs.length > 0) playSound("send");
  if (P.guest) {
    BOX.value = "";
    if (text !== "") {
      guest_send(text);
    }
    return;
  }
  act({ $: "Send", text, images: P.imgs });
  pics([]);
  BOX.value = "";
  BOX.dispatchEvent(new Event("input"));
}

// a message refused goes back in the box, unless another is in it; out
// of credit (402), the wallet opens, saying so, else the why is a toast
function back(sent: View.Sent, out: View.Answer): void {
  if (out.error === undefined) {
    return;
  }
  playSound("err");
  if (BOX.value.trim() === "" && P.imgs.length === 0) {
    BOX.value = sent.text;
    BOX.dispatchEvent(new Event("input"));
    pics(sent.images ?? []);
  }
  if (out.status !== 402) {
    toast(out.error);
    return;
  }
  $("#wallet .title").textContent = out.error;
  $("#wallet").showPopover();
}

// files to send with the next message, posted (a guest sends none)
function attach(files: File[]): void {
  if (!P.guest && files.length > 0) {
    pics([...P.imgs, ...files]);
  }
}

// the images waiting, shown over the box; a click drops one
const pic_urls: string[] = [];
function pics(imgs: Blob[]): void {
  for (const url of pic_urls) URL.revokeObjectURL(url);
  pic_urls.length = 0;
  const items = imgs.map((img) => {
    const url = URL.createObjectURL(img);
    pic_urls.push(url);
    return { url, remove: () => pics(imgs.filter((x) => x !== img)) };
  });
  P.imgs = imgs;
  setPendingPics(items);
  draw(true);
}

function act(a: View.Act): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  P.end = P.end || a.$ === "Send";
  P.rows = true;
  for (const msg of View.view_act(v, a)) {
    View.link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw(a.$ === "Send");
}

// A styled, top-layer confirmation. It is a manual popover so it sits
// over the Archived popover too, with its own focus trap and Escape.
type ConfirmAsk = { mode: "archive" | "restore"; title: string; body: string; yes: string; no: string };
let confirm_done: ((ok: boolean) => void) | null = null;
let confirm_prev: HTMLElement | null = null;

function close_confirm(ok: boolean): void {
  const done = confirm_done;
  confirm_done = null;
  document.body.classList.remove("confirm-open");
  const el = $("#confirm");
  if (el.matches(":popover-open")) el.hidePopover();
  const prev = confirm_prev;
  confirm_prev = null;
  prev?.focus();
  done?.(ok);
}

function ask_confirm(ask: ConfirmAsk): Promise<boolean> {
  const el = $("#confirm");
  if (confirm_done !== null) close_confirm(false);
  el.dataset.mode = ask.mode;
  $("#confirm .confirm-kicker").textContent = ask.mode;
  $("#confirm-title").textContent = ask.title;
  $("#confirm-body").textContent = ask.body;
  $("#confirm .confirm-no").textContent = ask.no;
  $("#confirm .confirm-yes").textContent = ask.yes;
  confirm_prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.classList.add("confirm-open");
  el.showPopover();
  requestAnimationFrame(() => $("#confirm .confirm-no").focus());
  return new Promise<boolean>((resolve) => { confirm_done = resolve; });
}

function initConfirm(): void {
  const el = $("#confirm");
  const no = $("#confirm .confirm-no");
  const yes = $("#confirm .confirm-yes");
  const scrim = $("#confirm .confirm-scrim");
  no.onclick = () => close_confirm(false);
  yes.onclick = () => close_confirm(true);
  scrim.onclick = (ev) => { if (ev.target === scrim) close_confirm(false); };
  el.addEventListener("cancel", (ev) => { ev.preventDefault(); close_confirm(false); });
  el.addEventListener("toggle", (ev) => {
    if ((ev as ToggleEvent).newState === "closed" && confirm_done !== null) close_confirm(false);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); close_confirm(false); return; }
    if (ev.key !== "Tab") return;
    const items = [...el.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  });
}

// a chat leaves the switcher, or comes back: only session.json changes,
// every message and tree on disk stays
async function archive_chat(id: string, on: boolean): Promise<void> {
  if (id === "") {
    return;
  }
  const ok = await ask_confirm(on ? {
    mode: "archive",
    title: "Archive this chat?",
    body: "It leaves the rail, but every message and its tree stay on disk. You can bring it back from Archived.",
    yes: "Archive",
    no: "Keep it",
  } : {
    mode: "restore",
    title: "Restore this chat?",
    body: "It returns to the rail in its workspace, with every message intact.",
    yes: "Restore",
    no: "Cancel",
  });
  if (!ok) {
    return;
  }
  fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, archive: on }),
  })
    .then((res) => res.json().catch(() => ({})))
    .then((out) => {
      if (out?.error) {
        toast(String(out.error));
        return;
      }
      playSound("ok");
      if (Array.isArray(out?.sessions)) {
        v.sessions = out.sessions;
        save_sessions();
        draw(false);
      }
    })
    .catch(() => toast("Could not reach the server."));
}

// a click on a View.Act, a Copy button, a page (go) or credit to buy
// (Html.ts), unless it ends a selection dragged in
// its element
function click(ev: MouseEvent): void {
  const prompt = (ev.target as HTMLElement).closest<HTMLElement>("[data-prompt]");
  if (prompt !== null) {
    ev.preventDefault();
    BOX.value = prompt.dataset.prompt ?? "";
    BOX.dispatchEvent(new Event("input"));
    BOX.focus();
    chats_close();
    return;
  }
  const workNew = (ev.target as HTMLElement).closest<HTMLElement>("[data-work-new]");
  if (workNew !== null) {
    ev.preventDefault();
    void work_open();
    return;
  }
  const newChat = (ev.target as HTMLElement).closest<HTMLElement>("[data-newchat]");
  if (newChat !== null) {
    ev.preventDefault();
    ev.stopPropagation();
    void new_chat(newChat.dataset.newchat ?? "");
    return;
  }
  const pickDir = (ev.target as HTMLElement).closest<HTMLElement>("[data-pick-dir]");
  if (pickDir !== null) {
    ev.preventDefault();
    void work_load(pickDir.dataset.pickDir ?? "");
    return;
  }
  const pickUp = (ev.target as HTMLElement).closest<HTMLElement>("[data-pick-up]");
  if (pickUp !== null) {
    ev.preventDefault();
    void work_load(P.dir?.parent ?? "");
    return;
  }
  const pickHome = (ev.target as HTMLElement).closest<HTMLElement>("[data-pick-home]");
  if (pickHome !== null) {
    ev.preventDefault();
    void work_load(P.dir?.home ?? "");
    return;
  }
  const pickChoose = (ev.target as HTMLElement).closest<HTMLElement>("[data-pick-choose]");
  if (pickChoose !== null) {
    ev.preventDefault();
    void work_choose();
    return;
  }
  const arc = (ev.target as HTMLElement).closest<HTMLElement>("[data-archive]");
  if (arc !== null) {
    ev.preventDefault();
    ev.stopPropagation();
    archive_chat(arc.dataset.archive ?? "", arc.dataset.on === "1");
    return;
  }
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act], [data-copy], [data-go], [data-usd], [data-session]");
  const sel = getSelection();
  if (el === null || (sel !== null && !sel.isCollapsed && el.contains(sel.focusNode))) {
    return;
  }
  const { act: a, copy: text, go: path, usd, session: chat } = el.dataset;
  const menu = el.closest("#menu") !== null;
  const rail = el.closest("#chats") !== null;
  if (menu) {
    $("#menu").hidePopover();
  }
  if (rail) {
    chats_close();
  }
  if (chat !== undefined) {
    ev.preventDefault();
    playSound("open");
    if (el.closest("#archived") !== null) {
      $("#archived").hidePopover();
    }
    leaving(() => switch_session(chat));
    return;
  }
  if (path !== undefined || (a !== undefined && menu)) {
    ev.preventDefault();
    go(path ?? "/");
  }
  if (a !== undefined) {
    act(JSON.parse(a));
  }
  if (usd !== undefined) {
    warned(el, () => topup(Number(usd)));
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}

function copied(button: HTMLElement): void {
  button.innerHTML = Html.CHECK;
  setTimeout(() => (button.innerHTML = Html.SHEETS), 1200);
}

// Voice
// =====
// The mic records (the browser's MediaRecorder: webm, or mp4 where only
// that is made) until clicked again; the server writes the recording
// out, paid as the calls, and its words join the box where the cursor
// is, to edit and send.

async function mic(): Promise<void> {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    playSound("err");
    toast("UniiChat can't use the microphone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts: Blob[] = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  playSound("open");
  draw(false);
  meter(stream, rec);
}

// While rec records, the box shows its loudness: a bar every 50 ms,
// scrolling left, and the time so far.
function meter(stream: MediaStream, rec: MediaRecorder): void {
  const audio = new AudioContext();
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $<HTMLCanvasElement>(".voice canvas");
  const pen = canvas.getContext("2d")!;
  const levels: number[] = [];
  const start = performance.now();
  const frame = (now: number): void => {
    if (P.rec !== rec) {
      audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0; i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function words(audio: Blob): void {
  const act: View.Client = { $: "voice", type: audio.type, body: () => audio };
  View.link_send(v, act, heard);
  draw(false);
}

function heard(out: View.Answer): void {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(BOX.value.slice(0, BOX.selectionStart)) ? " " : "";
  BOX.setRangeText(gap + text, BOX.selectionStart, BOX.selectionEnd, "end");
  BOX.dispatchEvent(new Event("input"));
  BOX.focus();
}

// Socket
// ======
// View's link; a socket lost opens again, but one that never showed the
// chat may be a session gone: then the page starts over.

let link_close: (() => void) | null = null;

function connect(): void {
  link_close = View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body }),
    hear : hear,
    lost : lost,
  });
}

async function lost(up: boolean): Promise<boolean> {
  draw(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}

// another chat, in this same tab: the view starts fresh and the socket
// reopens on its session, so the meter shows that chat's last context
// without a page load
function switch_session(id: string, push = true): void {
  const want = id === "default" ? "" : id;
  if (want === v.session) {
    return;
  }
  thought_pending = null;
  thought_hide(false);
  link_close?.();
  link_close = null;
  View.view_reset(v, want);
  P.session = want;
  save_sessions();
  reset_ctx();
  if (push) {
    history.pushState(null, "", want === "" ? "/" : "/?session=" + encodeURIComponent(want));
  }
  draw(true);
  connect();
}

addEventListener("popstate", () => {
  const q = new URLSearchParams(location.search);
  const want = q.get("session") === "default" ? "" : (q.get("session") ?? "");
  switch_session(want === "" ? "default" : want, false);
});

// a pick changed shows what it is now (a click on a knob moves it). The
// rows change with what they show: a state (credits, ~10/s importing)
// only by its agents, an agent's page saying whether it runs
// the bot's thought bubble, rendered by Tippy: its box, arrow and
// anchoring are the library's; this only feeds text, palette and the timer
let thought_instance: Instance | null = null;
let thought_timer = 0;
let thought_pending: { text: string; at: number } | null = null;
let thought_content: HTMLElement | null = null;

function thought_body(): HTMLElement {
  if (thought_content !== null) {
    return thought_content;
  }
  const el = document.createElement("div");
  el.className = "thought-body";
  el.innerHTML = '<span class="thought-text"></span><button class="thought-close" type="button" aria-label="Dismiss thought" title="Dismiss thought">×</button>';
  const close = el.querySelector(".thought-close");
  close?.addEventListener("click", () => thought_hide(true));
  close?.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Escape") {
      thought_hide(true);
    }
  });
  thought_content = el;
  return el;
}

function thought_tip(): Instance | null {
  if (thought_instance !== null) {
    return thought_instance;
  }
  const anchor = document.querySelector<HTMLElement>("#fx-brand .bot-brand");
  if (anchor === null) {
    return null;
  }
  thought_instance = tippy(anchor, {
    content: thought_body(),
    trigger: "manual",
    placement: "bottom",
    arrow: true,
    interactive: true,
    offset: [0, 12],
    maxWidth: 430,
    theme: "thought",
    animation: "fade",
    appendTo: () => document.body,
    onHidden: () => {
      const next = thought_pending;
      thought_pending = null;
      if (next !== null) {
        thought_render(next.text, next.at);
      }
    },
  });
  return thought_instance;
}

function thought_render(text: string, at: number): void {
  const tip = thought_tip();
  if (tip === null) {
    return;
  }
  const pal = v.bot !== null ? BOT_PALETTE[(v.bot as keyof typeof BOT_PALETTE)] ?? BOT_PALETTE.clover : BOT_PALETTE.clover;
  const box = tip.popper;
  box.style.setProperty("--pl-light", pal.light);
  box.style.setProperty("--pl-deep", pal.deep);
  box.style.setProperty("--pl-ink", pal.ink);
  box.style.setProperty("--pl-accent", pal.accent);
  const body = box.querySelector<HTMLElement>(".thought-text");
  if (body !== null) {
    body.textContent = text;
  }
  tip.show();
  clearTimeout(thought_timer);
  thought_timer = window.setTimeout(() => thought_hide(true), Math.max(0, at + BOT_LIFE_MS - Date.now()));
}

let thought_tries = 0;
function thought_show(text: string, at: number): void {
  const tip = thought_tip();
  if (tip === null) {
    if (thought_tries++ < 24) {
      window.setTimeout(() => thought_show(text, at), 250);
    }
    return;
  }
  thought_tries = 0;
  if (tip.state.isVisible) {
    thought_pending = { text, at };
    thought_hide(false);
    return;
  }
  thought_render(text, at);
}

function thought_hide(send: boolean): void {
  if (send) {
    View.link_send(v, { $: "thought-close" } as never);
  }
  clearTimeout(thought_timer);
  thought_timer = 0;
  const tip = thought_tip();
  if (tip === null) {
    return;
  }
  if (tip.state.isVisible) {
    tip.hide();
  } else {
    const next = thought_pending;
    thought_pending = null;
    if (next !== null) {
      thought_render(next.text, next.at);
    }
  }
}

function init_thought(): void {
  addEventListener("unii:bot-picker", (ev) => {
    if ((ev as CustomEvent).detail === true) {
      thought_hide(false);
    }
  });
}

// the prompt's body, by part, as a stacked meter under the skull
const CTX_PARTS: Array<[string, string, string]> = [
  ["tree", "tree", "var(--accent)"],
  ["messages", "messages", "var(--ink)"],
  ["images", "images", "var(--red)"],
  ["agent", "agent", "var(--accent-3)"],
  ["tools", "tools", "var(--accent-2)"],
  ["system", "system", "var(--mid)"],
];

const CTX_SHOWN: Record<string, number> = {};
let ctx_built = false;
let ctx_raf = 0;
const ctx_segs = new Map<string, HTMLElement>();
const ctx_vals = new Map<string, HTMLElement>();
const ctx_rows = new Map<string, HTMLElement>();
let ctx_order = CTX_PARTS.map(([key]) => key).join(",");
let ctx_total: HTMLElement | null = null;
let ctx_card: HTMLElement | null = null;

// the nine raw parts, merged to the five the meter shows; the log keeps
// the nine, so a stored context from before the merge still draws
function ctx_raw(m: Extract<View.Server, { $: "context" }>): Record<string, number> {
  const raw = (m as any).raw as Record<string, number> | undefined;
  return raw ?? (m as unknown as Record<string, number>);
}

function ctx_bytes(m: Extract<View.Server, { $: "context" }>): Record<string, number> {
  const r = ctx_raw(m);
  return {
    tree: Number(r.tree ?? 0),
    messages: Number(r.message ?? 0) + Number(r.notes ?? 0),
    images: Number(r.images ?? 0),
    agent: Number(r.agent ?? 0),
    tools: Number(r.tools ?? 0) + Number(r.tool ?? 0),
    system: Number(r.system ?? 0) + Number(r.harness ?? 0),
  };
}

function ctx_tok(m: Extract<View.Server, { $: "context" }>, bytes: number): number {
  return m.total > 0 ? (bytes / m.total) * m.tokens : 0;
}

// what each bucket holds, in a line, for the legend's tooltip
const CTX_DESC: Record<string, string> = {
  tree: "Summaries of the conversation's memory, with the lines still shown raw.",
  messages: "Your latest message, plus notes about dropped steps.",
  images: "Images attached to your messages.",
  agent: "This turn's thinking, text and tool calls.",
  tools: "Tool definitions and the results they returned.",
  system: "The system prompt and harness notes (devices, work in progress).",
};

function show_ctx_tip(row: HTMLElement, key: string, label: string): void {
  const tip = document.getElementById("ctx-tip");
  if (tip === null) {
    return;
  }
  tip.innerHTML = "<b>" + label + "</b><span>" + (CTX_DESC[key] ?? "") + "</span>";
  tip.hidden = false;
  const r = row.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - tw - 8));
  let top = r.top - th - 6;
  if (top < 8) {
    top = r.bottom + 6;
  }
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function hide_ctx_tip(): void {
  const tip = document.getElementById("ctx-tip");
  if (tip !== null) {
    tip.hidden = true;
  }
}

function build_ctx(): void {
  if (ctx_built) {
    return;
  }
  const bar = document.getElementById("ctx-bar");
  const legend = document.getElementById("ctx-legend");
  const total = document.getElementById("ctx-total");
  const card = document.querySelector<HTMLElement>("#ctx .ctx-card");
  if (bar === null || legend === null || total === null || card === null) {
    return;
  }
  ctx_built = true;
  ctx_total = total;
  ctx_card = card;
  for (const [key, label, color] of CTX_PARTS) {
    const seg = document.createElement("i");
    seg.style.background = color;
    seg.style.width = "0%";
    bar.appendChild(seg);
    ctx_segs.set(key, seg);
    const li = document.createElement("li");
    li.innerHTML = '<span class="dot" style="background:' + color + '"></span>'
      + '<span class="name">' + label + '</span>'
      + '<span class="val">—</span>';
    legend.appendChild(li);
    ctx_rows.set(key, li);
    li.addEventListener("pointerenter", () => show_ctx_tip(li, key, label));
    li.addEventListener("pointerleave", hide_ctx_tip);
    const val = li.querySelector<HTMLElement>(".val");
    if (val !== null) {
      ctx_vals.set(key, val);
    }
    CTX_SHOWN[key] = 0;
  }
  card.classList.add("idle");
}

// the biggest part first, in the legend and the bar; only touches the DOM
// when the order actually changes
function reorder_ctx(order: string[]): void {
  const sig = order.join(",");
  if (sig === ctx_order) {
    return;
  }
  ctx_order = sig;
  const bar = document.getElementById("ctx-bar");
  const legend = document.getElementById("ctx-legend");
  for (const key of order) {
    const row = ctx_rows.get(key);
    if (row !== undefined && legend !== null) {
      legend.appendChild(row);
    }
    const seg = ctx_segs.get(key);
    if (seg !== undefined && bar !== null) {
      bar.appendChild(seg);
    }
  }
}

// the numbers count up while the bar glides, so a new turn reads as one
// motion rather than a jump
function tween_ctx(to: Record<string, number>, tokens: number, window: number): void {
  cancelAnimationFrame(ctx_raf);
  const from: Record<string, number> = { ...CTX_SHOWN };
  const fromTotal = Object.values(CTX_SHOWN).reduce((n, v) => n + v, 0);
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / 550);
    const e = 1 - Math.pow(1 - t, 3);
    const shownTotal = Math.max(0, fromTotal + (tokens - fromTotal) * e);
    for (const [key] of CTX_PARTS) {
      const v = Math.max(0, from[key] + (to[key] - from[key]) * e);
      CTX_SHOWN[key] = v;
      const val = ctx_vals.get(key);
      if (val !== undefined) {
        val.textContent = (v / 1000).toFixed(1) + "k";
      }
    }
    if (ctx_total !== null) {
      ctx_total.textContent = (shownTotal / 1000).toFixed(1) + "k / " + (window / 1000).toFixed(1) + "k";
      ctx_total.classList.toggle("over", shownTotal > window);
    }
    if (t < 1) {
      ctx_raf = requestAnimationFrame(step);
    }
  };
  ctx_raf = requestAnimationFrame(step);
}

function draw_context(m: Extract<View.Server, { $: "context" }>): void {
  build_ctx();
  if (!ctx_built) {
    return;
  }
  const window = m.window ?? 81920;
  const bytes = ctx_bytes(m);
  const to: Record<string, number> = {};
  for (const [key] of CTX_PARTS) {
    to[key] = ctx_tok(m, bytes[key] ?? 0);
  }
  reorder_ctx(
    CTX_PARTS.map(([key]) => key).sort((a, b) => (to[b] ?? 0) - (to[a] ?? 0)),
  );
  for (const [key, label] of CTX_PARTS) {
    const seg = ctx_segs.get(key);
    if (seg !== undefined) {
      seg.style.width = Math.max(0, Math.min(100, (to[key] / window) * 100)) + "%";
    }
  }
  ctx_card?.classList.remove("idle");
  if (ctx_card !== null) {
    ctx_card.classList.remove("pulse");
    void ctx_card.offsetWidth;
    ctx_card.classList.add("pulse");
  }
  tween_ctx(to, m.tokens, window);
}

// a chat with no turn yet: the meter stays on screen, empty
function reset_ctx(): void {
  build_ctx();
  cancelAnimationFrame(ctx_raf);
  if (ctx_total !== null) {
    ctx_total.textContent = "—";
    ctx_total.classList.remove("over");
  }
  for (const [key] of CTX_PARTS) {
    CTX_SHOWN[key] = 0;
    const seg = ctx_segs.get(key);
    if (seg !== undefined) {
      seg.style.width = "0%";
    }
    const val = ctx_vals.get(key);
    if (val !== undefined) {
      val.textContent = "—";
    }
  }
  ctx_card?.classList.add("idle");
  ctx_card?.classList.remove("pulse");
  hide_ctx_tip();
  reorder_ctx(CTX_PARTS.map(([key]) => key));
}

function hear(msg: View.Server): void {
  if (msg.$ === "context") {
    draw_context(msg);
    return;
  }
  if (msg.$ === "thought") {
    if (msg.session !== undefined && msg.session !== v.session) {
      return;
    }
    thought_show(msg.text, msg.at);
    return;
  }
  if (msg.$ === "thought-close") {
    thought_hide(false);
    return;
  }
  const was = View.view_pick(v);
  const agents = v.agents.join();
  const beforeBusy = v.busy;
  const beforeStream = v.page === null ? v.live : v.page.live;
  const hadText = beforeStream.some((part) => part.kind === "unii" && part.text.trim() !== "");
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  const afterStream = v.page === null ? v.live : v.page.live;
  const hasText = afterStream.some((part) => part.kind === "unii" && part.text.trim() !== "");
  if (!hadText && hasText) playSound("recv");
  if (beforeBusy && !v.busy) playSound("ok");
  const now = View.view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  if (msg.$ === "root") {
    tree_roots = msg.parts;
  }
  if (msg.$ === "state") {
    P.loaded = true;
    P.session = v.session;
    save_sessions();
    // ask once for the canonical tree roots of this session; the agent's
    // eye parts are not the tree and can be hundreds of leaves
    if (tree_roots_for !== v.session) {
      tree_roots_for = v.session;
      tree_roots = [];
      tree_roots_asked = false;
      tree_open.clear();
    }
    if (!tree_roots_asked) {
      tree_roots_asked = true;
      View.link_send(v, { $: "root" }, () => {});
    }
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() !== agents : msg.$ !== "delta" && msg.$ !== "live";
  import_welcome();
  draw(true);
}

// Import
// ======
// Import History: offered once to a new account on a computer, and in
// the menu. A folder picked, or a site's export (a zip), is read for its
// sessions' heads, each app's list folded (all picked; open it to
// leave some out); then what it finds and costs, and Import (short of
// credit, Add $N and import: checkout in a new tab, the import starting
// once paid); then its progress, Pause or Resume. All follows from P and
// a status. A picked file can't be read once it changes, so each is
// copied as first read.

function importer(): void {
  const form = $<HTMLFormElement>("#import form");
  const dir  = $<HTMLInputElement>("#import [name=dir]");
  $(".imp").onclick = () => import_open(false);
  const zip  = $<HTMLInputElement>("#import [name=zip]");
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    src.querySelector<HTMLButtonElement>(".pickzip")!.onclick = () => zip.click();
    src.querySelector<HTMLButtonElement>(".pickzip")!.title = "From the website: " + Import.EXPORTS[src.dataset.app!] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    P.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => (ev.target as HTMLElement).closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = Import.MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if ((ev as ToggleEvent).newState === "closed") {
      P.step = P.step === "pay" || P.step === "start" || P.step === "done" ? "" : P.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target as HTMLInputElement;
    if (box.name === "session") {
      box.checked ? P.off.delete(box.value) : P.off.add(box.value);
    }
    import_draw("");
  };
  // drawn once as the read starts (a draw lists every session found)
  dir.onchange = async () => {
    const all = [...(dir.files ?? [])];
    const files = all.filter((f) => Import.import_file(f.webkitRelativePath));
    const found: Import.Session[] = [];
    let moved = 0;
    const reading = (k: number) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => Import.import_session(b, "log"), () => undefined);
      moved += s === undefined ? 1 : 0;
      found.push(...(s ? [s] : []));
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await Import.import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + (e as Error).message);
      }
    }
    zip.value = "";
  };
  // short of credit, Import adds it first, in a new tab (this one keeps
  // the folder), and imports once it is in
  form.onsubmit = (ev) => {
    ev.preventDefault();
    warned(form, import_go);
  };
}

// Import: at once, or short of credit, after paying
function import_go(): void {
  const add = import_add(import_plan());
  if (add === 0) {
    return import_send();
  }
  import_buy(add);
}

// the progress's button: Pause, Resume, or, the import waiting for
// credit, Add $N, paid as Import is
function import_flow(): void {
  const run = v.importing;
  if (run?.why === View.BROKE) {
    return warned($("#import .flow"), () => import_buy(View.progress_need(run, v.credits)));
  }
  View.link_send(v, { $: "go", on: Boolean(run?.why) }, (out) => out.error && toast(out.error));
}

// credit for the import, in a new tab, awaited once checkout opened;
// refused (past the most one payment takes, a test server, BendAI
// down), the box is as before it, to press again
async function import_buy(usd: number): Promise<void> {
  P.step = "pay";
  import_draw(PAYING);
  if (await topup(usd)) {
    return import_pay();
  }
  P.step = "";
  import_draw("");
}

// before an account's first import or payment on this browser, a warning:
// this is experimental software, money in may be lost, uploads may leak
// (accepted, it holds past a reload or a payment's trip). It opens
// inside the box that asked (so a click on it never light-dismisses that
// box, which keeps its folder and opens checkout in a new tab), and its
// "I accept the risk" runs then in its own click, so checkout's tab opens
function warned(from: HTMLElement, then: () => void): void {
  if (localStorage.getItem(kept("risked")) !== null) {
    return then();
  }
  const box = $("#risk");
  (from.closest("[popover]") ?? document.body).append(box);
  box.querySelector<HTMLButtonElement>(".no")!.onclick = () => box.hidePopover();
  box.querySelector<HTMLButtonElement>(".ok")!.onclick = () => {
    localStorage.setItem(kept("risked"), "1");
    box.hidePopover();
    then();
  };
  box.showPopover();
}

// the box, opened by the menu or as a new account's first step
async function import_open(first: boolean): Promise<void> {
  $("#menu").hidePopover();
  P.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  P.step = first ? "start" : P.step === "done" ? "" : P.step;
  import_draw("");
  $("#import").showPopover();
}

// a source read, its sessions by name; the slider at all again (its left end:
// the draw's min pulls it up to the first day). Its min goes first: a range
// keeps its value within its bounds (set under the last min, today with nothing
// read, it stays at today)
function import_took(name: string, read: Read, status: string): void {
  P.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}

// a new account (its chat only its OPENING), on a computer: the box, once
// on this browser (a payment's trip, or a reload, never asks again), after
// the intro; and only while the account has this one chat, so a new chat
// in a history that exists never brings it back
async function import_welcome(): Promise<void> {
  await INTRO;
  const key = "unii.welcomed." + (P.id === "" ? "guest" : P.id);
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === View.OPENING && v.sessions.length <= 1 && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}

// while a payment is awaited: the balance, every few seconds and as the
// payment's tab says it is paid (the server reads it only when asked),
// until it covers the import, which then starts; an import waiting for
// it goes on by itself
async function import_pay(): Promise<void> {
  while (P.step === "pay") {
    await new Promise((ok) => {
      setTimeout(ok, 3000);
      PAID.onmessage = ok;
    });
    const me = await fetch("/api/me").then((res) => res.json()).catch(() => null);
    v.credits = me?.credits ?? v.credits;
    if (P.step === "pay" && v.importing === null && v.credits !== null && v.credits >= import_plan().guess) {
      import_send();
    }
  }
}

function import_send(): void {
  const picked = import_plan().picked;
  P.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(Import.import_body(picked), (part) => new Blob([part])));
  View.link_send(v, { $: "import", body }, import_sent);
}

// the box stays open on the import's progress (the answer says whether it
// still runs: its first progress may come before or after it)
function import_sent(out: View.Answer): void {
  P.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    P.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}

// the credit an import of plan adds first (Import.topup; 0: none)
function import_add(plan: Import.Plan): number {
  return plan.msgs > 0 && v.credits !== null ? Import.topup(plan.guess, v.credits) : 0;
}

// the import the box wants
function import_plan(): Import.Plan {
  const form = new FormData($("#import form"));
  const want = { off: [...P.off], since: import_since(), tools: form.has("tools") };
  const found = [...P.found.values()].flatMap((read) => read.sessions);
  return Import.import_plan(found, want, P.done, View.view_count(v));
}

// the slider's day, the first one taken ("2026-06-01"; at its left end,
// all: ""): it runs in days from the first new message's to today
function import_since(): string {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 864e5).toISOString().slice(0, 10) : "";
}

// an import's progress, in the box and the header, once it is sent or
// while one runs (from any tab: its step is then "seen", whatever the box
// showed, but "pay" while it waits for the credit paid); at its end the
// box says so, until closed. Whether it shows.
function import_bar(): boolean {
  const run = v.importing;
  const broke = run?.why === View.BROKE;
  const paying = broke && P.step === "pay";
  P.step = run !== null && !paying ? "seen" : P.step === "seen" ? "done" : P.step;
  const done  = P.step === "done";
  const going = paying || ["send", "run", "seen", "done"].includes(P.step);
  const part  = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why   = Boolean(run?.why);
  const said  = run !== null ? View.progress_show(v, run) : done ? Import.DONE : P.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = P.step !== "start";
  $("#import form").hidden = going || P.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $<HTMLProgressElement>("#import progress").value = part;
  $<HTMLProgressElement>(".imping progress").value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = !why ? "Building memory" : run!.why === View.BROKE ? "Needs credit" : "Import paused";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = broke ? "Add $" + View.progress_need(run, v.credits) : why ? "Resume" : "Pause";
  $<HTMLButtonElement>("#import .flow").hidden = run === null;
  $<HTMLButtonElement>("#import .flow").disabled = paying;
  markup($("#import .prog .topup"), broke ? [Html.fine_html(APP !== null)] : []);
  return going;
}

// the box as P says, with a status (reading, paying, or why not)
function import_draw(status: string): void {
  if (import_bar()) {
    return;
  }
  const reads    = [...P.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan     = import_plan();
  const msgs     = plan.msgs;
  const add      = import_add(plan);
  const left     = reads.reduce((n, read) => n + read.moved, 0);
  const moved    = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const has      = add > 0 ? " · you have " + View.usd_show(v.credits!) : "";
  const found    = sessions.length === 0 ? "" : plan.first === "" ? Import.OLD : Import.import_count(msgs, "new ") + (msgs > 0 ? " · about " + Import.guess_usd(plan.guess) + has : "");
  const day = (at: string | number) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 864e5));
  BACK.max = String(Math.floor(Date.now() / 864e5));
  $("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", (100 * (BACK.valueAsNumber - Number(BACK.min))) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $("#import .want").hidden = plan.first === "";
  $("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list  = src.querySelector(".sessions")!;
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${Html.esc(s.where + ", " + Import.import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${Html.esc(Import.import_id(s))}">${Import.import_cells(s).map((c) => `<span>${Html.esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => (box.checked = !P.off.has(box.value)));
    const on = shown.filter((s) => !P.off.has(Import.import_id(s))).length;
    src.querySelector<HTMLElement>(".pick")!.hidden = shown.length === 0;
    src.querySelector(".pick summary")!.textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  markup($("#import form .topup"), add > 0 ? [Html.fine_html(APP !== null)] : []);
  const [go, dir] = [$<HTMLButtonElement>("#import .go"), $<HTMLButtonElement>(".pickdir")];
  go.hidden = msgs === 0;
  go.textContent = add > 0 ? "Add $" + add + " and import" : "Import";
  go.disabled = P.step === "pay" || status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => (src.querySelector<HTMLButtonElement>(".pickzip")!.disabled = dir.disabled));
}

// each app's box (index.html .src, by data-app)
function import_srcs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#import .src")];
}

// a picked file as it is now, copied a chunk at a time (the browser keeps
// the chunks, on disk when large, so the page never holds it whole)
async function import_copy(file: File): Promise<Blob> {
  const reader = file.stream().getReader();
  const parts: Blob[] = [];
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}

// Drawing
// =======

// an element's children, one per markup, each made only when no child
// has its markup: the rest stay as they are, so a fold or a new message
// touches its own row only, and what is under the mouse, selected or
// loaded stays (a reply streams into its last row only)
const MARKUP = new WeakMap<Element, string>();

function markup(el: Element, htmls: string[]): void {
  const had = new Map<string, Element[]>();
  for (const child of el.children) {
    const html = MARKUP.get(child)!;
    const same = had.get(html) ?? [];
    same.push(child);
    had.set(html, same);
  }
  const kids = htmls.map((html) => had.get(html)?.shift() ?? html_parse(html));
  for (const left of had.values()) {
    left.forEach((child) => child.remove());
  }
  let at = el.firstElementChild;
  for (const kid of kids) {
    if (kid === at) {
      at = at.nextElementSibling;
    } else {
      el.insertBefore(kid, at);
    }
  }
}

// one markup's element, its markup kept
function html_parse(html: string): Element {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = made.content.firstElementChild!;
  MARKUP.set(child, html);
  return child;
}

// draws the page at the next frame; stick: keep the bottom, if at it
function draw(stick: boolean): void {
  P.stick = P.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(paint);
  }
}

// a new chat shown opens at its bottom (folded: its top); the account
// page shown, only the bars
let painted = false;
const seen_messages = new Set<string>();

// Reveal the log only once its height has stopped moving. The page is
// scrolled to the bottom on every settling frame, so the first visible
// frame already is the bottom: never a top-to-bottom scroll.
let settling = false;
let settle_since = 0;
let settle_height = -1;
let settle_stable = 0;
function reveal(): void {
  if (!P.loaded && !P.guest) return;
  if (document.body.classList.contains("chat-ready") || settling) return;
  settling = true;
  settle_since = 0;
  settle_height = -1;
  settle_stable = 0;
  const step = (): void => {
    const doc = document.documentElement;
    const now = performance.now();
    if (settle_since === 0) settle_since = now;
    to_bottom();
    if (doc.scrollHeight === settle_height) {
      settle_stable += 1;
    } else {
      settle_height = doc.scrollHeight;
      settle_stable = 0;
    }
    if (settle_stable >= 3 || now - settle_since > 1200) {
      document.body.classList.add("chat-ready");
      settling = false;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paint(): void {
  if (!$("#account").hidden) {
    P.frame = 0;
    bars();
    return;
  }
  const doc = document.documentElement;
  const follow = P.stick && P.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
  const sessionChanged = v.session !== P.sessionShown;
  P.sessionShown = v.session;
  P.frame = 0;
  P.stick = true;
  bars();
  if (P.rows) {
    markup($("#log .rows"), View.view_body(v).map((row) => Html.row_html(row, v.session)));
    P.rows = false;
  }
  const tail = View.view_tail(v).filter((row) => row.$ !== "Cap" || !/^(waiting for |compressing earlier messages)/.test(row.text));
  markup($("#log .tail"), tail.map((row) => Html.row_html(row, v.session)));
  // a message rises in once, when its id first appears; a streaming row is
  // re-rendered every delta with the same id and must never re-animate
  document.querySelectorAll<HTMLElement>("#log .msg").forEach((el) => {
    const id = el.dataset.a ?? "";
    if (id === "" || seen_messages.has(id)) return;
    seen_messages.add(id);
    if (painted) el.classList.add("fresh");
  });
  painted = true;
  highlightCode($("#log"));
  if (shown !== P.shown) {
    P.shown = shown;
    if (sessionChanged) {
      P.end = true;
      to_bottom();
      reveal();
      return;
    }
    if (v.fold === null) to_bottom(); else scrollTo(0, 0);
    reveal();
    return;
  }
  if (sessionChanged) {
    P.end = true;
    to_bottom();
    reveal();
    return;
  }
  if (follow) {
    to_bottom();
    reveal();
    return;
  }
  if (at === null) {
    reveal();
    return;
  }
  const rows = [...document.querySelectorAll<HTMLElement>("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
  }
  reveal();
}

// whether the agent has started putting anything on screen: prose, a
// thought, a tool call or a result. The loader must be gone before the
// first of these renders.
function agent_output_started(): boolean {
  const stream = v.page === null ? v.live : v.page.live;
  if (stream.some((part) => part.kind !== "user" && part.text.trim() !== "")) {
    return true;
  }
  if (v.page?.log?.some((entry) => entry.kind !== "user" && entry.text.trim() !== "")) {
    return true;
  }
  const last = v.parts[v.parts.length - 1];
  if (last === undefined) {
    return false;
  }
  const at = last[0] + last[1] - 1;
  return (v.minds.get(at) ?? []).some((text) => text.trim() !== "");
}

// The chat's summary/message tree, in the shape the skull renders. Cached
// by the tree's own signature so streaming text does not rebuild the 3D
// scene, while a new summary or message does.
let skull_key = "";
let skull_tree: SkullTree = SKULL_SEED;
// The canonical roots of the backend tree (Memory.roots), not the agent's
// eye parts. They cover the whole chat as the fewest power-of-two ranges;
// the graph starts there and grows a layer per click.
let tree_roots: View.Part[] = [];
let tree_roots_for = "__none";
let tree_roots_asked = false;
// Ranges the reader has opened. A pending summary still exposes its two
// halves when clicked; those halves may themselves be pending, and so on.
const tree_open = new Set<string>();

function skull_kind(kind: string): string {
  switch (kind) {
    case "user": return "you";
    case "unii": return "UniiChat";
    case "tool": return "tool call";
    case "echo": return "tool result";
    case "work": return "agent";
    case "mind": return "thought";
    case "note": return "note";
    default: return kind;
  }
}

function tree_for_view(): SkullTree {
  // Only the canonical tree roots: the agent's eye parts are not the tree
  // and can be hundreds of individual messages.
  const roots = tree_roots.slice();
  let nodeChars = 0;
  let nodeHash = 0;
  for (const [key, node] of v.nodes) {
    nodeChars += node.text.length;
    for (let i = 0; i < node.text.length; i += 13) {
      nodeHash = (nodeHash * 31 + node.text.charCodeAt(i) + key.length) | 0;
    }
  }
  let wholeChars = 0;
  let wholeHash = 0;
  for (const [id, entry] of v.whole) {
    wholeChars += entry.text.length;
    for (let i = 0; i < entry.text.length; i += 13) {
      wholeHash = (wholeHash * 31 + entry.text.charCodeAt(i) + id) | 0;
    }
  }
  const key = v.session + "|" + roots.map(([id, n]) => id + ":" + n).join(",")
    + "|" + v.nodes.size + ":" + nodeChars + ":" + nodeHash
    + "|" + v.whole.size + ":" + wholeChars + ":" + wholeHash
    + "|" + v.turn
    + "|" + [...tree_open].sort().join(",");
  if (key === skull_key) return skull_tree;
  skull_key = key;
  // Only ranges the page has actually been taught are in the graph. The
  // server teaches a node's two halves when it is clicked, so the tree grows
  // exactly one layer at a time and has no renderer-side ceiling: every node
  // and every message in the backend's tree can be reached by clicking.
  const root: SkullTree = {
    id: "root",
    label: "memory tree",
    kind: "root",
    text: roots.length === 0
      ? "A new chat. Its memory tree grows here."
      : "Every neuron is a summary; its leaves are the messages inside it.",
    loaded: true,
    key,
    children: [],
  };
  const seen = new Set<string>();
  const add = (parent: SkullNode, id: number, n: number): void => {
    const slot = id + "+" + n;
    if (seen.has(slot)) return;
    seen.add(slot);
    const node = n > 1 ? v.nodes.get(slot) : undefined;
    const entry = n === 1 ? v.whole.get(id) : undefined;
    const loaded = n > 1 ? node !== undefined : entry !== undefined;
    const kind = n > 1 ? "summary" : (entry?.kind ?? "message");
    const child: SkullNode = {
      id: slot,
      label: n > 1 ? n + "× summary" : skull_kind(kind),
      // The node's own text, and only that. A branch with nothing taught yet
      // is a pending neuron, never a label or its children's text.
      text: (n > 1 ? node?.text ?? "" : entry?.text ?? "").trim(),
      kind,
      loaded,
      children: [],
    };
    parent.children.push(child);
    if (n > 1 && loaded) {
      add(child, id, n / 2);
      add(child, id + n / 2, n / 2);
    }
  };
  for (const [id, n] of roots) add(root, id, n);
  skull_tree = root;
  return skull_tree;
}

// the header's and the footer's parts that change, and the notes, a
// server's or an act's ("/help is no command", "haiku-5.5 has no fast"),
// as toasts
function bars(): void {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  const credits = View.view_credits(v);
  const on = View.view_typing(v);
  const stop = on && v.busy && BOX.value.trim() === "" && P.imgs.length === 0;
  const tabs = View.view_tabs(v);
  const send = $<HTMLButtonElement>(".send");
  $(".net").hidden = v.up;
  $(".credits").hidden = credits === null;
  $(".credits").textContent = credits;
  $(".credits").setAttribute("aria-label", credits === null ? "Credit balance" : "Credit balance " + credits + ", open account");
  document.body.classList.toggle("bills", v.bills);
  send.classList.toggle("stop", stop);
  send.disabled = !on;
  BOX.disabled = !on;
  $<HTMLButtonElement>(".attach").disabled = !on;
  $<HTMLButtonElement>(".mic").disabled = !on || v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("off", !on);
  $(".composer").classList.toggle("rec", P.rec !== null);
  markup($("#pick"), Html.pick_html(View.view_fold(v), v.fold === null, View.view_pick(v)));
  $("#tabs").hidden = tabs.length < 2;
  markup($("#tabs"), Html.tabs_html(tabs));
  const rail_sessions = rail_query === ""
    ? v.sessions
    : v.sessions.filter((chat) => {
        const title = (chat.title.trim() === "" ? "new chat" : chat.title).toLowerCase();
        return title.includes(rail_query) || chat.work.toLowerCase().includes(rail_query);
      });
  const rail_empty = rail_query === ""
    ? "No chats yet."
    : "No chats match <strong>" + Html.esc(rail_query) + "</strong>.";
  markup($("#chats .sessions"), Html.sessions_html(rail_sessions, v.session, v.works, rail_empty));
  markup($("#archived .archived-list"), Html.archived_html(v.sessions, v.works));
  const here = v.sessions.find((chat) => chat.id === v.session);
  document.title = location.pathname === "/account"
    ? "Account · UniiChat"
    : here !== undefined && here.title.trim() !== ""
      ? here.title.trim() + " · UniiChat"
      : "UniiChat";
  import_bar();
  const empty = !P.guest && v.parts.length === 0 && !v.busy;
  const welcome = $("#welcome");
  if (welcome !== null) {
    welcome.hidden = !empty;
  }
  const output = agent_output_started();
  const activity = document.getElementById("fx-activity");
  if (activity !== null) activity.hidden = output;
  document.body.classList.toggle("has-output", output);
  setShell({ busy: v.busy, wait: v.wait, agents: v.agents, recording: P.rec !== null, welcome: empty, stop, text: output, tree: tree_for_view(), bot: v.bot, session: v.session, setBot: (name: string) => View.link_send(v, { $: "bot-avatar", name } as never) });
  jump_update();
  refreshPalette();
}

// the first row in sight with a first message (no row inside it): that
// message, and where it is on screen. None in sight: the page keeps its
// scroll, as those rows only grow at its end
function anchor(): { a: number; top: number } | null {
  for (const r of document.querySelectorAll<HTMLElement>("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}

// Account
// =======
// The account page (Html.account_html), drawn anew each time it is shown
// and after each act on it.

// shows the page at path: the chat ("/") or the account
// screen and session changes are immediate; no full-page fade
function leaving(run: () => void): void {
  run();
}

function go(path: string): void {
  const session = P.session === "" || P.session === "default" ? "" : P.session;
  const to = path + (session === "" ? "" : "?session=" + encodeURIComponent(session));
  if (location.pathname + location.search !== to) {
    history.pushState(null, "", to);
  }
  route();
}

// the account page keeps of the footer only its toasts (style.css)
function route(): void {
  const page = location.pathname === "/account";
  $("#log").hidden = page;
  document.body.classList.toggle("account", page);
  $("#account").hidden = !page;
  P.shown = location.pathname;
  if (page) {
    account();
  }
  draw(false);
}

async function account(): Promise<void> {
  const el = $("#account");
  const res = await fetch("/api/account").catch(() => null);
  const a: View.Account | null = res !== null && res.ok ? await res.json() : null;
  if (a === null) {
    el.innerHTML = `<p class="sub">Could not read your account. Try again in a moment.</p>`;
    return;
  }
  el.innerHTML = Html.account_html(a, APP !== null, v.session);
  const kill = $<HTMLFormElement>("#account .kill");
  const del  = $<HTMLButtonElement>("#account .del");
  const name = kill.querySelector("input")!;
  const sure = (open: boolean) => {
    kill.hidden = !open;
    del.hidden = open;
  };
  del.onclick = () => {
    sure(true);
    name.focus();
  };
  $("#account .keep").onclick = () => sure(false);
  name.oninput = () => (kill.querySelector<HTMLButtonElement>(".red")!.disabled = name.value.trim().toLowerCase() !== a.name.toLowerCase());
  $("#account .out").onclick = signout;
  kill.onsubmit = (ev) => {
    ev.preventDefault();
    account_delete(kill);
  };
}

async function signout(): Promise<void> {
  await View.post("/api/logout", {});
  location.href = "/";
}

// the rail closes when a chat is picked, New chat starts, or the veil is
// tapped; a desktop keeps it open, its toggle being out of sight
function chats_close(): void {
  document.body.classList.remove("chats-open");
  $(".chats-toggle").setAttribute("aria-expanded", "false");
}

// a fresh chat, with its own memory tree: the server makes it, then the
// page opens it (a new socket, a new view, no shared state)
async function new_chat(work?: string): Promise<void> {
  chats_close();
  const target = work !== undefined && work !== "" ? work : v.work !== "" ? v.work : v.works[0] ?? "";
  if (target === "") {
    await work_open();
    return;
  }
  playSound("open");
  const out = await View.post("/api/session", { work: target });
  if (typeof out.id !== "string") {
    toast(out.error ?? "Could not start a chat.");
    return;
  }
  if (Array.isArray(out.sessions)) {
    v.sessions = out.sessions;
  }
  if (Array.isArray(out.works)) {
    v.works = out.works;
  }
  save_sessions();
  leaving(() => {
    location.href = "/?session=" + encodeURIComponent(out.id);
  });
}

// the folder picker: open at this chat's work, walk the tree, choose one;
// choosing adds the work dir and starts a chat in it
async function work_open(): Promise<void> {
  chats_close();
  playSound("open");
  $("#workdir").showPopover();
  await work_load("");
}

async function work_load(path: string): Promise<void> {
  const input = $("#workdir .pick-path") as HTMLInputElement | null;
  const was = input?.value.trim() ?? "";
  const out = await fetch("/api/dirs" + (path === "" ? "" : "?path=" + encodeURIComponent(path))).then((res) => res.json()).catch(() => null);
  if (out === null) {
    toast("Can't reach the server.");
    return;
  }
  if (typeof out.error === "string" && out.error !== "") {
    toast(out.error);
  }
  P.dir = out;
  if (input !== null) {
    const now = input.value.trim();
    // a load already in flight must not replace a path typed while it ran
    if (now === "" || now === was) {
      input.value = typeof out.path === "string" ? out.path : "";
    }
  }
  markup($("#workdir .dirs"), Html.dirs_html(Array.isArray(out.dirs) ? out.dirs : []));
}

async function work_choose(): Promise<void> {
  const input = $("#workdir .pick-path") as HTMLInputElement | null;
  const typed = input?.value.trim() ?? "";
  const path = typed !== "" ? typed : P.dir?.path ?? "";
  if (path === "") {
    return;
  }
  const out = await View.post("/api/works", { path });
  if (typeof out.work !== "string") {
    toast(out.error ?? "Could not use that folder.");
    return;
  }
  if (Array.isArray(out.works)) {
    v.works = out.works;
    save_sessions();
  }
  $("#workdir").hidePopover();
  await new_chat(path);
}

// the server deletes it all, once the account's name is typed
async function account_delete(kill: HTMLFormElement): Promise<void> {
  const name = kill.querySelector("input")!.value;
  const out = await View.post("/api/delete", { confirm: name });
  if (out.error === undefined) {
    location.href = "/?deleted";
    return;
  }
  kill.querySelector(".why")!.textContent = out.error;
}

// Notes
// =====

// in the app, the App Store's (ios/ buys, then posts the purchase); else
// Stripe's checkout, in this page, or in a new tab while Import History
// is open (a page left loses the folder picked); it comes back to the
// page that bought (back: the chat, or the account page). Whether it
// started (refused, the why is a toast)
async function topup(usd: number): Promise<boolean> {
  if (APP !== null) {
    $("#wallet").hidePopover();
    APP.postMessage({ buy: usd });
    return true;
  }
  const tab = $("#import").matches(":popover-open") ? open("", "_blank") : null;
  const out = await View.post("/api/topup", { usd, tab: tab !== null, back: location.pathname });
  if (out.url) {
    (tab ?? window).location.href = out.url;
    return true;
  }
  tab?.close();
  toast(out.error ?? "Could not start the payment.");
  return false;
}

function toast(text: string): void {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = setTimeout(() => (el.hidden = true), 7000) as unknown as number;
}

// Intro
// =====
// Once per browser (?skip: never), over the page; style.css times it, and
// its last animation, a click or a key ends it. Played, it is done once
// gone (INTRO), so no box opens over it.

function intro_play(): Promise<void> {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end(): void {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK.matches) {
        BOX.focus();
      }
    }
    el.id = "intro";
    el.innerHTML = SCENES;
    el.onclick = end;
    el.onanimationend = (ev) => {
      if (ev.target === el) {
        end();
      }
    };
    addEventListener("keydown", end);
    document.documentElement.append(el);
  });
}

const INTRO = intro_play();
boot();
