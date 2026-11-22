// The real Libraries.dev components, mounted as React islands inside the
// vanilla UniChat shell, plus a gallery that exposes every free library,
// component, state, variant and documented prop.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { BotAvatar } from "bot-avatars";
import { Liquid } from "liquid-gooey";
import { MetalBadge, MetalFx, MetalText, useMetalBend } from "metal-fx";
import { ImageGeneration } from "img-fx";
import { VoiceBeam, useMicrophone } from "voice-glow";
import { VoiceRing } from "voice-ring";
import { DistortionWave } from "distortion-waves";
import { playSound } from "./polish";
import { SKULL_SEED, mountNeural, type NeuralHandle, type SkullNode, type SkullTree } from "./neural";
import { BOTS, BOT_NAMES } from "../../Bot.ts";

// ---------------------------------------------------------------------------
// The complete Library.dev sidebar, enumerated

type Control = { key: string; label: string; values: string[] };
type Lib = {
  id: string;
  name: string;
  pkg: string;
  component: string;
  kind: "effect" | "input";
  pitch: string;
  integrated: string;
  elements: string[];
  controls: Control[];
};

const ORBS = ["working", "searching", "solving", "listening", "connecting", "weaving", "composing", "breathing", "shaping"];
const BOTS = ["clover", "flower", "star", "ghost", "mech", "circle", "hexagon", "square"];
const BEAM_SIZES = ["md", "line", "sm", "pulse-inner", "pulse-outside"];
const BEAM_COLORS = ["colorful", "mono", "ocean", "sunset", "forest", "candy", "ice", "gold"];
const GOOEY = ["morph", "move", "bend", "melt"];
const METAL_PRESETS = ["chromatic", "silver", "gold"];
const IMAGE_PRESETS = ["pixels-organic", "pixels-mechanic", "sweep-gradient"];
const VOICE_TYPES = ["default", "mobile", "pill"];
const VOICE_COLORS = ["colorful", "mono", "ocean", "sunset", "forest", "candy", "ice", "gold"];
const RING_TYPES = ["ring", "mono"];
const RING_STATES = ["idle", "listening", "speaking", "processing"];
const EMOTIONS = ["positive", "negative", "calm"];
const ACCENTS = ["green", "red", "blue"];
const WAVE_TYPES = ["vertical", "horizontal", "center"];
const WAVE_PALETTES = ["colorful", "green", "ocean", "sunset", "mono"];

export const LIBS: Lib[] = [
  {
    id: "beam",
    name: "Border beam",
    pkg: "border-beam",
    component: "BorderBeam",
    kind: "effect",
    pitch: "An animated rainbow glow that rides the border of any card, button or input.",
    integrated: "Composer while generating · new-chat · welcome card",
    elements: [
      "BorderBeam wrapper (detects the first child's radius; forwards div props)",
      "size=md · line · sm · pulse-inner · pulse-outside",
      "colorVariant=colorful · mono · ocean · sunset · forest · candy · ice · gold",
      "active · strength 0–1 · theme dark/light · staticColors",
      "duration · borderRadius · brightness · saturation · glowSize · hueRange",
      "Layers: travelling beam, bloom, pulse breathing; pauses offscreen",
    ],
    controls: [
      { key: "size", label: "size", values: BEAM_SIZES },
      { key: "color", label: "colorVariant", values: BEAM_COLORS },
      { key: "active", label: "active", values: ["on", "off"] },
    ],
  },
  {
    id: "orbs",
    name: "Thinking orbs",
    pkg: "thinking-orbs",
    component: "ThinkingOrb",
    kind: "effect",
    pitch: "Dotted thought-orb loading indicators for AI interfaces, with nine hand-tuned states.",
    integrated: "Activity line · welcome hero · send state",
    elements: [
      "ThinkingOrb canvas (role=img with a per-state label)",
      "state=working (tilted orbits) · searching (scan meridian)",
      "solving (quarter-turn bands) · listening (latitude waveform)",
      "connecting (constellation) · weaving (three plaited strands)",
      "composing (undulating sash) · breathing (morphing ring)",
      "shaping (circle → triangle → square outline)",
      "size=64 / 20 · paused · theme auto/dark/light",
      "cursor gravity (needs a pointer sprite)",
    ],
    controls: [
      { key: "state", label: "state", values: ORBS },
      { key: "size", label: "size", values: ["64", "20"] },
      { key: "theme", label: "theme", values: ["dark", "light"] },
    ],
  },
  {
    id: "bots",
    name: "Bot avatars",
    pkg: "bot-avatars",
    component: "BotAvatar",
    kind: "effect",
    pitch: "Animated plush and glossy bots with living faces for agents and assistants.",
    integrated: "Brand mark · welcome hero",
    elements: [
      "BotAvatar canvas (role=img, per-state label)",
      "type=clover · flower · star · ghost · mech · circle · hexagon · square",
      "state=default · working · sleeping",
      "size=96 · 64 · 32 or any CSS length",
      "shading=fabric · plastic · crisp · smooth · flat",
      "hat=beret/beanie/party/crown · glasses=round/square/shades",
      "headphones · bowTie · accessoryColor · path · face · pose",
      "paused · speed · seed · click-to-hop · pointer-following eyes",
      "Fur: furLength · furDensity · furFuzz · furClumps · furCurl · lighting",
    ],
    controls: [
      { key: "type", label: "type", values: BOTS },
      { key: "state", label: "state", values: ["default", "working", "sleeping"] },
      { key: "size", label: "size", values: ["96", "64", "32"] },
      { key: "shading", label: "shading", values: ["fabric", "plastic"] },
    ],
  },
  {
    id: "gooey",
    name: "Gooey",
    pkg: "liquid-gooey",
    component: "Liquid + Liquid.Item",
    kind: "effect",
    pitch: "Liquid UI: pieces merge and morph like goo while the content stays crisp.",
    integrated: "Effects gallery · ready for the plus/attach menu",
    elements: [
      "Liquid group (SVG silhouette + real shadow)",
      "Liquid.Item (content stays real DOM)",
      "effect=morph · move · bend · melt",
      "blur 0–16 · contrast 4–40 · fill · shadow · filterPadding",
      "x · y · transition snappy/smooth/bouncy or {duration,ease} · delay",
      "move {stiffness, damping, stretch, tail, force, bend, bendX}",
      "bend/dissolve tuning · waviness · wavinessFreq · filter",
      "reduced motion snaps x/y; move/bend/melt follow your motion",
    ],
    controls: [{ key: "effect", label: "effect", values: GOOEY }],
  },
  {
    id: "metal",
    name: "Liquid metal",
    pkg: "metal-fx",
    component: "MetalFx / MetalText / MetalBadge",
    kind: "effect",
    pitch: "A real-time liquid-metal material for buttons, icons, text and badges.",
    integrated: "Send button ring",
    elements: [
      "MetalFx variant=button (pill, 1px ring)",
      "MetalFx variant=circle (round icon, 2px ring)",
      "preset=chromatic · silver · gold",
      "theme auto/dark/light · strength · innerShadow · paused",
      "reflectionTargets · disableGlow · glowGain · metalOpacity · shaderScale",
      "MetalText (font, colour, strength, innerShadow, reflection targets)",
      "MetalBadge (New, Pro, Beta)",
      "useMetalBend · useMetalTextReflection · setCursorLightConfig",
      "Falls back to the plain child without WebGL2",
    ],
    controls: [
      { key: "variant", label: "variant", values: ["button", "circle"] },
      { key: "preset", label: "preset", values: METAL_PRESETS },
      { key: "theme", label: "theme", values: ["dark", "light"] },
    ],
  },
  {
    id: "image",
    name: "Image",
    pkg: "img-fx",
    component: "ImageGeneration",
    kind: "effect",
    pitch: "A churning pixel-mosaic loader that dissolves into the generated image.",
    integrated: "Effects gallery · welcome image card",
    elements: [
      "ImageGeneration card (sizes to the child; radius from the child)",
      "preset=pixels-organic · pixels-mechanic · sweep-gradient",
      "strength · pixelScale · cardBg · colors · theme",
      "images string/array · autoReveal · revealDelayRange · paused",
      "triggerReveal() · triggerReveal({hold:'manual'}) · triggerHide()",
      "triggerRegenerate({durationMs}) · isImageActive()",
      "10fps · shared WebGL context · context-loss recovery",
    ],
    controls: [{ key: "preset", label: "preset", values: IMAGE_PRESETS }],
  },
  {
    id: "voice",
    name: "Voice",
    pkg: "voice-glow",
    component: "VoiceBeam + useMicrophone",
    kind: "effect",
    pitch: "A colour-reactive glow along the bottom edge that rises with a voice and sweeps while processing.",
    integrated: "Composer voice/processing glow",
    elements: [
      "VoiceBeam type=default · mobile · pill",
      "stream · level number/getter · processing · paused",
      "useMicrophone: idle/requesting/live/denied/unsupported/error",
      "colorVariant=colorful/mono/ocean/sunset/forest/candy/ice/gold",
      "colors (7 lobes) · bandColors core/above/mid/below",
      "sensitivity · threshold · attack · release · reach · spread",
      "flow · bend · idle · theme · strength · active · scale",
    ],
    controls: [
      { key: "type", label: "type", values: VOICE_TYPES },
      { key: "color", label: "colorVariant", values: VOICE_COLORS },
      { key: "processing", label: "processing", values: ["off", "on"] },
    ],
  },
  {
    id: "ring",
    name: "Voice ring",
    pkg: "voice-ring",
    component: "VoiceRing",
    kind: "effect",
    pitch: "A glassy spectrum ring, or two grey tube loops, that bends with the voice and leans to the speaker.",
    integrated: "Composer recording overlay",
    elements: [
      "VoiceRing type=ring (glassy spectrum)",
      "VoiceRing type=mono (two tube loops opening into a globe)",
      "state=idle · listening · speaking · processing",
      "emotion=positive/negative/calm · accent=green/red/blue",
      "sensitivity/threshold/attack/release/idle/calm/voiceSpeed",
      "saturation · gradientAngle/Spin · neutral · colorBrightness",
      "direction lean + directionMove/Pull/Deform/Squash/Lens/Stretch/Split/Blur/Bounce",
      "hoverBend · theme · speed · paused · dots/dotSize",
    ],
    controls: [
      { key: "type", label: "type", values: RING_TYPES },
      { key: "state", label: "state", values: RING_STATES },
      { key: "emotion", label: "emotion", values: EMOTIONS },
      { key: "accent", label: "accent", values: ACCENTS },
    ],
  },
  {
    id: "waves",
    name: "Distortion waves",
    pkg: "distortion-waves",
    component: "DistortionWave",
    kind: "effect",
    pitch: "A colourful wave that carries one screen into the next, leaving colour on the edges.",
    integrated: "Effects gallery · session transition",
    elements: [
      "DistortionWave view pair (children + revealedContent)",
      "type=vertical · horizontal · center",
      "source element/rect/point · focus point",
      "palette=colorful/green/ocean/sunset/mono · cornerRadius · scale",
      "waveStyle: anticipation, travel, linger, rim, blur, aberration, swell",
      "particles, hairlines, palette, reducedMotion, live/capture",
      "play() · reverse() · reset() · prepare() · onFinish",
    ],
    controls: [
      { key: "type", label: "type", values: WAVE_TYPES },
      { key: "palette", label: "palette", values: WAVE_PALETTES },
    ],
  },
  {
    id: "magnetic",
    name: "Magnetic UI",
    pkg: "MagnetKit",
    component: "Magnet model",
    kind: "input",
    pitch: "An on-device model that tells views where a magnet is, whether it is there, and when it taps the air.",
    integrated: "Input model; documented binding in the gallery",
    elements: [
      "Position in screen points, height above the glass, uncertainty",
      "Presence 0–1 over the last 15s, plus the phone offset",
      "Air taps ~0.1s before the hand returns, with where it landed",
      "Pose: in hand or flat on a desk",
      "Input only: pair with MetalFx, VoiceRing or any view",
      "On-device; no network request at runtime; no permission prompt",
    ],
    controls: [{ key: "output", label: "output", values: ["position", "presence", "tap"] }],
  },
  {
    id: "voice-position",
    name: "Voice position",
    pkg: "VoicePositionKit",
    component: "VoicePosition model",
    kind: "input",
    pitch: "A tiny on-device model that hears left, ahead or right, and near or far.",
    integrated: "Input model; leans the voice ring in the gallery",
    elements: [
      "Side: left/ahead/right; passes through centre when switching",
      "Distance: small/large (large from ~70cm)",
      "Pose: in hand or flat on a desk; distance desk-only",
      "Optional 3s calibration from left/ahead/right",
      "Microphone only; audio never leaves the phone",
      "Input only: pair it with VoiceRing or any view",
    ],
    controls: [
      { key: "side", label: "side", values: ["left", "ahead", "right"] },
      { key: "distance", label: "distance", values: ["small", "large"] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Gallery previews — every one is the real package component

function hasWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return c.getContext("webgl2") !== null || c.getContext("webgl") !== null;
  } catch { return false; }
}

function useTick(): number {
  const [, set] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number): void => {
      if (now - last > 120) { last = now; set((n) => (n + 1) % 100000); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return performance.now() / 1000;
}

function imageData(): string[] {
  if (typeof document === "undefined") return [];
  const make = (a: string, b: string, c: string): string => {
    const cv = document.createElement("canvas");
    cv.width = 320; cv.height = 240;
    const ctx = cv.getContext("2d");
    if (ctx === null) return "";
    const g = ctx.createLinearGradient(0, 0, 320, 240);
    g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 320, 240);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + (i % 5) * 0.02})`;
      ctx.beginPath();
      ctx.arc((i * 97) % 320, (i * 61) % 240, 20 + (i % 7) * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return cv.toDataURL("image/png");
  };
  return [make("#1e1b4b", "#7c3aed", "#22d3ee"), make("#3b0764", "#db2777", "#fbbf24")];
}

function BeamPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  return (
    <div className="g-center">
      <BorderBeam
        size={(s.size ?? "md") as never}
        colorVariant={(s.color ?? "colorful") as never}
        theme="dark"
        active={s.active !== "off"}
        strength={0.95}
        borderRadius={22}
        style={{ display: "inline-block" }}
      >
        <div className="g-beam-card">
          <span className="g-kicker">BorderBeam</span>
          <b>Ask anything</b>
          <span className="g-muted">The border is doing the waiting.</span>
        </div>
      </BorderBeam>
    </div>
  );
}

function OrbPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  return (
    <div className="g-center g-orb-stage" data-theme={s.theme ?? "dark"}>
      <ThinkingOrb state={(s.state ?? "working") as never} size={Number(s.size ?? 64) as never} theme={(s.theme ?? "dark") as never} />
      <div className="g-caption"><b>{s.state ?? "working"}</b><span>{s.size ?? "64"} px</span></div>
    </div>
  );
}

function BotPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  return (
    <div className="g-center">
      <div className="g-bot-stage">
        <BotAvatar
          type={(s.type ?? "clover") as never}
          state={(s.state ?? "default") as never}
          size={Number(s.size ?? 96)}
          shading={(s.shading ?? "fabric") as never}
        />
      </div>
      <div className="g-caption"><b>{s.type ?? "clover"}</b><span>{s.state ?? "default"} · {s.shading ?? "fabric"} · {s.size ?? "96"}px</span></div>
    </div>
  );
}

function GooeyPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const effect = (s.effect ?? "morph") as "morph" | "move" | "bend" | "melt";
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (effect === "move" || effect === "bend") {
      const id = setInterval(() => setPos((p) => (p + 1) % 2), 1400);
      return () => clearInterval(id);
    }
  }, [effect]);
  const imgs = useMemo(() => imageData(), []);
  if (effect === "melt") {
    return (
      <div className="g-center">
        <Liquid fill="transparent" blur={8} contrast={18} style={{ position: "relative", width: 360, height: 220 }}>
          <Liquid.Item effect="melt" style={{ position: "absolute", left: 50, top: 50 }}>
            <img className="g-melt-img" src={imgs[0]} alt="" width={110} height={110} style={{ borderRadius: 20 }} />
          </Liquid.Item>
          <Liquid.Item effect="melt" style={{ position: "absolute", left: 175, top: 70 }}>
            <img className="g-melt-img" src={imgs[1]} alt="" width={110} height={110} style={{ borderRadius: 20 }} />
          </Liquid.Item>
        </Liquid>
        <div className="g-caption"><b>melt</b><span>two images run molten into each other</span></div>
      </div>
    );
  }
  if (effect === "move") {
    return (
      <div className="g-center">
        <Liquid fill="#525252" style={{ position: "relative", width: 300, height: 150 }}>
          <div className="g-move-track" aria-hidden="true" />
          <Liquid.Item effect="move" style={{ position: "absolute", left: 20, top: 45 }}>
            <div className="g-move-thumb" style={{ transform: `translateX(${pos ? 190 : 0}px)`, transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }} />
          </Liquid.Item>
        </Liquid>
        <div className="g-caption"><b>move</b><span>the surface trails the thumb</span></div>
      </div>
    );
  }
  if (effect === "bend") {
    return (
      <div className="g-center">
        <Liquid fill="#202020" style={{ position: "relative", width: 340, height: 190 }}>
          <Liquid.Item effect="bend" style={{ position: "absolute", left: 60, top: 45 }}>
            <div className="g-bend-card" style={{ transform: `translate(${pos ? 90 : 0}px, ${pos ? 16 : 0}px)`, transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }}>Gooey Project</div>
          </Liquid.Item>
        </Liquid>
        <div className="g-caption"><b>bend</b><span>the body bows with drag velocity</span></div>
      </div>
    );
  }
  return (
    <div className="g-center">
      <Liquid fill="#202020" blur={6} contrast={18} shadow="0 2px 6px rgba(0,0,0,.3)" style={{ position: "relative", width: 300, height: 200 }}>
        <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition="bouncy" style={{ position: "absolute", left: 130, top: 120 }}>
          <button className="g-round" type="button" aria-label="New file">+</button>
        </Liquid.Item>
        <Liquid.Item x={0} y={open ? -76 : 0} transition="bouncy" delay={50} style={{ position: "absolute", left: 130, top: 120 }}>
          <button className="g-round" type="button" aria-label="Add image">▣</button>
        </Liquid.Item>
        <Liquid.Item x={open ? 54 : 0} y={open ? -34 : 0} transition="bouncy" delay={90} style={{ position: "absolute", left: 130, top: 120 }}>
          <button className="g-round" type="button" aria-label="New folder">▱</button>
        </Liquid.Item>
        <Liquid.Item style={{ position: "absolute", left: 130, top: 120 }}>
          <button className="g-round g-round-main" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span>+</span></button>
        </Liquid.Item>
      </Liquid>
      <button className="g-chip" type="button" onClick={() => setOpen((o) => !o)}>{open ? "close" : "open"} menu</button>
      <div className="g-caption"><b>morph</b><span>a plus that splits into actions</span></div>
    </div>
  );
}

function MetalPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  return (
    <div className="g-center g-metal-stage">
      <div className="g-metal-row">
        <MetalFx variant={(s.variant ?? "button") as never} preset={(s.preset ?? "chromatic") as never} theme={(s.theme ?? "dark") as never} strength={0.92} innerShadow glowGain={1.1}>
          <button className="g-metal-button" type="button">Upgrade to Pro</button>
        </MetalFx>
        <MetalFx variant="circle" preset={(s.preset ?? "chromatic") as never} theme={(s.theme ?? "dark") as never} strength={0.92} innerShadow>
          <button className="g-metal-circle" type="button" aria-label="Send">↑</button>
        </MetalFx>
      </div>
      <div className="g-metal-row g-metal-texts">
        <MetalText font="500 26px/1.2 Inter, sans-serif" color="#E2E2E2" strength={0.9}>Pro</MetalText>
        <MetalBadge>New</MetalBadge>
      </div>
      <div className="g-caption"><b>MetalFx · MetalText · MetalBadge</b><span>{s.variant ?? "button"} · {s.preset ?? "chromatic"}</span></div>
    </div>
  );
}

function ImagePreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const imgs = useMemo(() => imageData(), []);
  const webgl = useMemo(() => hasWebgl(), []);
  if (!webgl) {
    return <div className="g-center"><p className="g-muted">ImageGeneration needs WebGL. Enable hardware acceleration to see the live shader.</p></div>;
  }
  return (
    <div className="g-center">
      <ImageGeneration preset={(s.preset ?? "pixels-organic") as never} images={imgs} autoReveal strength={1}>
        <div className="g-image-card" />
      </ImageGeneration>
      <div className="g-caption"><b>{s.preset ?? "pixels-organic"}</b><span>autoReveal · the mosaic dissolves into the image</span></div>
    </div>
  );
}

function VoicePreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const mic = useMicrophone();
  const level = useRef(0.4);
  const tick = useTick();
  useEffect(() => { level.current = 0.3 + 0.22 * Math.sin(tick * 2.2) + 0.08 * Math.sin(tick * 5.1); }, [tick]);
  return (
    <div className="g-center g-voice-center">
      <div className="g-voice-beam-demo">
        <VoiceBeam
          type={(s.type ?? "default") as never}
          colorVariant={(s.color ?? "colorful") as never}
          theme="dark"
          level={mic.stream === null ? () => level.current : undefined}
          stream={mic.stream}
          {...(s.processing === "on" ? { processing: "true" as never } : {})}
        >
          <div className="g-voice-input">
            <span>Ask anything</span>
            <i>●</i>
          </div>
        </VoiceBeam>
      </div>
      <div className="g-row-actions">
        <button className="g-chip" type="button" onClick={() => (mic.state === "live" ? mic.stop() : void mic.start())}>{mic.state === "live" ? "Stop mic" : "Use microphone"}</button>
        <span className="g-muted">mic: {mic.state}</span>
      </div>
      <div className="g-caption"><b>VoiceBeam · {s.type ?? "default"}</b><span>{s.processing === "on" ? "processing sweep" : "level-driven beam"}</span></div>
    </div>
  );
}

function RingPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const tick = useTick();
  const level = useRef(0.4);
  const dir = useRef(0);
  useEffect(() => { level.current = 0.3 + 0.24 * Math.sin(tick * 1.9); dir.current = Math.sin(tick * 0.5) * 0.8; }, [tick]);
  return (
    <div className="g-center g-ring-center">
      <VoiceRing
        type={(s.type ?? "ring") as never}
        state={(s.state ?? "listening") as never}
        emotion={(s.emotion ?? "positive") as never}
        accent={(s.accent ?? "green") as never}
        theme="dark"
        size={240}
        level={() => level.current}
        direction={() => dir.current}
      />
      <div className="g-caption"><b>{s.type ?? "ring"} · {s.state ?? "listening"}</b><span>{s.emotion ?? "positive"} · {s.accent ?? "green"}</span></div>
    </div>
  );
}

function WavesPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="g-center">
      <div className="g-wave-demo">
        <DistortionWave
          type={(s.type ?? "vertical") as never}
          palette={(s.palette ?? "colorful") as never}
          revealed={revealed}
          revealedContent={<div className="g-wave-b">Next view</div>}
          onFinish={(v) => setRevealed(v)}
        >
          <div className="g-wave-a">Current view</div>
        </DistortionWave>
        <button className="g-chip g-wave-toggle" type="button" onClick={() => setRevealed((v) => !v)}>{revealed ? "Reverse" : "Play wave"}</button>
      </div>
      <div className="g-caption"><b>{s.type ?? "vertical"}</b><span>{s.palette ?? "colorful"} · the real DistortionWave</span></div>
    </div>
  );
}

function MagneticPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  const [p, setP] = useState({ x: 50, y: 50, present: false });
  return (
    <div className="g-center">
      <div
        className="g-magnet-stage"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setP({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, present: true });
        }}
        onPointerLeave={() => setP((v) => ({ ...v, present: false }))}
      >
        <span className="g-magnet" style={{ left: `${p.x}%`, top: `${p.y}%`, opacity: p.present ? 1 : 0.35 }} />
        <span className="g-magnet-readout">position {p.x.toFixed(0)}, {p.y.toFixed(0)}<br />presence {p.present ? "0.98" : "0.04"}<br />tap {p.present ? "ready" : "—"}</span>
      </div>
      <div className="g-caption"><b>Magnetic UI · {s.output ?? "position"}</b><span>input model; pointer stands in for the magnetometer</span></div>
    </div>
  );
}

function PositionPreview({ s }: { s: Record<string, string> }): React.ReactElement {
  return (
    <div className="g-center">
      <div className="g-position-stage">
        <span className="g-side left">◀ left</span>
        <span className="g-side ahead">● ahead</span>
        <span className="g-side right">right ▶</span>
        <span className={"g-voice-dot " + (s.distance ?? "small")} style={{ left: s.side === "left" ? "18%" : s.side === "right" ? "82%" : "50%" }} />
      </div>
      <div className="g-caption"><b>{s.side ?? "ahead"} · {s.distance ?? "small"}</b><span>input model; the ring leans with this side</span></div>
    </div>
  );
}

const PREVIEWS: Record<string, (p: { s: Record<string, string> }) => React.ReactElement> = {
  beam: BeamPreview, orbs: OrbPreview, bots: BotPreview, gooey: GooeyPreview, metal: MetalPreview,
  image: ImagePreview, voice: VoicePreview, ring: RingPreview, waves: WavesPreview,
  magnetic: MagneticPreview, "voice-position": PositionPreview,
};

function Gallery({ onClose }: { onClose: () => void }): React.ReactElement {
  const [id, setId] = useState("beam");
  const [state, setState] = useState<Record<string, string>>({});
  const lib = LIBS.find((l) => l.id === id) ?? LIBS[0];
  const Preview = PREVIEWS[lib.id];
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.classList.add("fx-open");
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || root.current === null) return;
      const items = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    addEventListener("keydown", onKey);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-fx-close], .gallery-close")?.focus());
    return () => { removeEventListener("keydown", onKey); document.body.classList.remove("fx-open"); };
  }, [onClose]);
  return (
    <div className="gallery" ref={root} role="dialog" aria-modal="true" aria-label="Libraries.dev effects">
      <div className="gallery-head">
        <div>
          <span className="g-kicker">Libraries.dev · real packages, native island</span>
          <h1>Effects library</h1>
          <p>Nine libraries and two input models. Every free component, state, variant and prop — live.</p>
        </div>
        <button className="gallery-close" type="button" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="gallery-body">
        <nav className="gallery-nav" aria-label="Libraries">
          {LIBS.map((l) => (
            <button key={l.id} type="button" className={l.id === id ? "on" : ""} onClick={() => { setId(l.id); setState({}); }}>
              <b>{l.name}</b><span>{l.pkg}</span><em>{l.elements.length} elements</em>
            </button>
          ))}
        </nav>
        <main className="gallery-stage">
          <div className="gallery-lib-head">
            <div>
              <span className="g-kicker">{lib.kind} · {lib.pkg}</span>
              <h2>{lib.name}</h2>
              <p>{lib.pitch}</p>
            </div>
            <div className="gallery-meta"><b>{lib.component}</b><span>{lib.elements.length} documented elements</span></div>
          </div>
          <div className="gallery-preview">
            {Preview ? <Preview s={{ ...defaults(lib), ...state }} /> : null}
          </div>
          <div className="gallery-controls">
            {lib.controls.map((c) => (
              <div className="gallery-control" key={c.key}>
                <span>{c.label}</span>
                <div>{c.values.map((v) => (
                  <button key={v} type="button" className={({ ...defaults(lib), ...state })[c.key] === v ? "on" : ""} onClick={() => setState((s) => ({ ...s, [c.key]: v }))}>{v}</button>
                ))}</div>
              </div>
            ))}
          </div>
          <div className="gallery-used"><i />{lib.integrated}</div>
          <h3>Every element in this library</h3>
          <ul className="gallery-elements">{lib.elements.map((e) => <li key={e}>{e}</li>)}</ul>
        </main>
      </div>
    </div>
  );
}

function defaults(lib: Lib): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of lib.controls) out[c.key] = c.values[0];
  return out;
}

// The UI suite uses a browser profile with WebGL-heavy welcome islands
// off. The live check never sets this, so the real effect path is still
// exercised end to end.
function isLite(): boolean {
  try { return localStorage.getItem("unii.lite") === "1"; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Shell islands

type ShellState = { busy: boolean; wait: string; agents: string[]; welcome: boolean; recording: boolean; stop: boolean; text: boolean; tree: SkullTree; bot: string | null; setBot: (name: string | null) => void; session: string };
let shell: ShellState = { busy: false, wait: "", agents: [], welcome: false, recording: false, stop: false, text: false, tree: SKULL_SEED, bot: null, setBot: () => {}, session: "" };
const shellSubs = new Set<(s: ShellState) => void>();

export function setShell(next: Partial<ShellState>): void {
  const prev = shell;
  shell = { ...shell, ...next };
  if (prev.busy !== shell.busy || prev.wait !== shell.wait || prev.agents.join() !== shell.agents.join() || prev.welcome !== shell.welcome || prev.recording !== shell.recording || prev.stop !== shell.stop || prev.text !== shell.text || prev.tree !== shell.tree || prev.bot !== shell.bot || prev.session !== shell.session) {
    shellSubs.forEach((fn) => fn(shell));
  }
}

function useShell(): ShellState {
  const [s, set] = useState(shell);
  useEffect(() => { shellSubs.add(set); set(shell); return () => { shellSubs.delete(set); }; }, []);
  return s;
}

let galleryOpen = false;
const gallerySubs = new Set<(v: boolean) => void>();
const setGallery = (v: boolean): void => { galleryOpen = v; gallerySubs.forEach((fn) => fn(v)); };
export function openGallery(): void { setGallery(true); playSound("open"); }
function useGallery(): boolean {
  const [v, set] = useState(galleryOpen);
  useEffect(() => { gallerySubs.add(set); set(galleryOpen); return () => { gallerySubs.delete(set); }; }, []);
  return v;
}

function BrandIsland(): React.ReactElement | null {
  const lite = useMemo(() => isLite(), []);
  const s = useShell();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [s.session]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("unii:bot-picker", { detail: open }));
  }, [open]);
  if (lite) return null;
  const bot = s.bot !== null && (BOTS as readonly string[]).includes(s.bot) ? s.bot : null;
  return (
    <>
      <button className="bot-brand" type="button" aria-label="Choose this chat's bot" aria-expanded={open} onClick={() => setOpen(!open)}>
        {bot === null ? <span className="bot-empty" aria-hidden="true" /> : <BotAvatar type={bot as never} state={s.busy ? "working" : "default"} size={30} shading="fabric" aria-label="UniiChat" />}
      </button>
      {open && (
        <div className="bot-picker" role="dialog" aria-label="Choose this chat's bot">
          <div className="bot-picker-head">your bot</div>
          <div className="bot-picker-grid">
            <button type="button" className={"bot-pick" + (bot === null ? " on" : "")} onClick={() => { s.setBot(null); setOpen(false); }} aria-label="No bot">
              <span className="bot-pick-empty" aria-hidden="true" />
              <span>NONE</span>
            </button>
            {BOTS.map((name) => (
              <button key={name} type="button" className={"bot-pick" + (name === bot ? " on" : "")} onClick={() => { s.setBot(name); setOpen(false); }} aria-label={BOT_NAMES[name]}>
                <BotAvatar type={name as never} state="default" size={40} shading="fabric" />
                <span>{BOT_NAMES[name]}</span>
              </button>
            ))}
          </div>
          <div className="bot-picker-hint">each chat picks its own</div>
        </div>
      )}
    </>
  );
}

function ActivityIsland(): React.ReactElement | null {
  const s = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const show = (s.busy || s.wait !== "") && !s.text;
  useEffect(() => {
    if (!show || ref.current === null) return;
    const near = innerHeight + scrollY >= document.documentElement.scrollHeight - 180;
    if (!near) return;
    const id = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "auto" }));
    return () => cancelAnimationFrame(id);
  }, [show]);
  if (!show) return null;
  // the Libraries.dev ThinkingOrb is the whole signal; the wait lives in
  // the accessible name
  const label = s.wait !== "" ? s.wait : s.agents.length > 0 ? s.agents.join(" · ") : "Working";
  const state = /search|web/i.test(s.wait + " " + s.agents.join(" ")) ? "searching" : /code|run|solv/i.test(s.wait + " " + s.agents.join(" ")) ? "solving" : /writ|compos|generat/i.test(s.wait) ? "composing" : "working";
  return (
    <div ref={ref} className="activity-loader" role="status" aria-live="polite" aria-label={label}>
      <ThinkingOrb state={state as never} size={32} theme="auto" />
    </div>
  );
}

function ComposerIsland(): React.ReactElement | null {
  const s = useShell();
  const lite = useMemo(() => isLite(), []);
  const [level, setLevel] = useState(0.1);
  useEffect(() => {
    if (!s.recording) { setLevel(0.08); return; }
    let raf = 0;
    const loop = (): void => { setLevel(0.25 + Math.random() * 0.4); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [s.recording]);
  if (lite) return null;
  return (
    <div className="composer-island" aria-hidden="true">
      <BorderBeam size="md" colorVariant="colorful" theme="auto" active={s.busy} strength={0.8} borderRadius={24} className="composer-beam" style={{ position: "absolute", inset: 0 }}>
        <div className="composer-beam-child" />
      </BorderBeam>
      {(s.recording || s.busy) && (
        <div className="composer-voice">
          <VoiceBeam type="default" theme="auto" level={s.recording ? level : 0} {...(s.busy && !s.recording ? { processing: "true" as never } : {})}>
            <div className="composer-voice-child" />
          </VoiceBeam>
        </div>
      )}
      {s.recording && (
        <div className="composer-ring">
          <VoiceRing type="ring" state="listening" emotion="calm" accent="blue" theme="auto" size={46} level={level} />
        </div>
      )}
    </div>
  );
}

function SendIsland(): React.ReactElement {
  const s = useShell();
  const lite = useMemo(() => isLite(), []);
  const bend = useRef<HTMLDivElement>(null);
  useMetalBend(bend);
  if (s.busy && !s.text) {
    return (
      <div className="send-island send-island-loading" aria-hidden="true">
        <ThinkingOrb state="working" size={20} theme="auto" />
      </div>
    );
  }
  if (lite) {
    return (
      <div className="send-island send-island-lite" aria-hidden="true">
        {s.stop
          ? <svg className="send-metal-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
          : <svg className="send-metal-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>}
      </div>
    );
  }
  return (
    <div className="send-island" aria-hidden="true">
      <MetalFx ref={bend} variant="circle" preset="chromatic" theme="auto" strength={s.busy ? 1 : 0.85} innerShadow glowGain={1}>
        <div className="send-metal-child">
          {s.stop ? (
            <svg className="send-metal-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
          ) : (
            <svg className="send-metal-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
          )}
        </div>
      </MetalFx>
    </div>
  );
}

function WelcomeImage(): React.ReactElement | null {
  const s = useShell();
  const webgl = useMemo(() => hasWebgl(), []);
  const imgs = useMemo(() => imageData(), []);
  const lite = useMemo(() => { try { return localStorage.getItem("unii.lite") === "1"; } catch { return false; } }, []);
  if (!s.welcome || !webgl || lite) return null;
  return (
    <div className="welcome-image">
      <ImageGeneration preset="pixels-mechanic" images={imgs} autoReveal>
        <div className="welcome-image-card" />
      </ImageGeneration>
    </div>
  );
}

function WelcomeIsland(): React.ReactElement | null {
  const lite = useMemo(() => { try { return localStorage.getItem("unii.lite") === "1"; } catch { return false; } }, []);
  if (lite) return null;
  return (
    <div className="welcome-island" aria-hidden="true">
      <ThinkingOrb state="breathing" size={64} theme="auto" />
      <BotAvatar type="star" state="default" size={96} shading="fabric" />
    </div>
  );
}

function findSkullNode(tree: SkullNode, id: string): SkullNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findSkullNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

function SkullIsland(): React.ReactElement | null {
  const s = useShell();
  const lite = useMemo(() => isLite(), []);
  const webgl = useMemo(() => hasWebgl(), []);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<NeuralHandle | null>(null);
  const asked = useRef(new Set<string>());
  const treeRef = useRef(s.tree);
  treeRef.current = s.tree;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const session = s.tree.key?.split("|")[0] ?? "";
  const lastSession = useRef(session);
  const selected = useMemo(
    () => (selectedId === null ? null : findSkullNode(s.tree, selectedId)),
    [s.tree, selectedId],
  );

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = (): void => setDark(media.matches);
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, []);

  useEffect(() => {
    if (lastSession.current === session) return;
    lastSession.current = session;
    asked.current.clear();
    setSelectedId(null);
  }, [session]);

  const ask = (id: number, n: number): void => {
    if (n < 2) return;
    const key = id + "+" + n;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    dispatchEvent(new CustomEvent("unii:skull-load", { detail: { id, n } }));
  };

  const selectNode = (node: SkullNode): void => {
    setSelectedId(node.id);
    const [id, n] = node.id.split("+").map(Number);
    if (!Number.isInteger(id) || !Number.isInteger(n)) return;
    if (n > 1) {
      ask(id, n);
    } else if (node.text.trim() === "" && node.loaded === false) {
      ask(id - (id % 2), 2);
    }
  };
  const selectRef = useRef(selectNode);
  selectRef.current = selectNode;

  useEffect(() => {
    if (lite || !webgl || host.current === null) return;
    const handle = mountNeural(host.current, dark, (node) => selectRef.current(node));
    scene.current = handle;
    handle.update(treeRef.current);
    return () => {
      handle.dispose();
      scene.current = null;
    };
  }, [lite, webgl, dark]);

  useEffect(() => {
    scene.current?.update(s.tree);
  }, [s.tree]);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSelectedId(null);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  if (lite || !webgl) return null;
  return (
    <div className="skull-ui">
      <div ref={host} className="skull-canvas" />
      <div className="skull-head">
        <div className="skull-head-left">
          {selected !== null && <b className="skull-context">{selected.label}</b>}
        </div>
        <small>drag to rotate · click a branch to expand · click a message to read</small>
      </div>
      <div className="skull-credit">skull · Jake K-H · CC BY</div>
      {selected !== null && (
        <div className="skull-reader" role="dialog" aria-label="Memory context">
          <div className="skull-reader-head">
            <span>{selected.kind}</span>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Close context">← Close</button>
          </div>
          <h2>{selected.label}</h2>
          <p>{selected.text.trim() !== ""
            ? selected.text
            : selected.loaded === false
              ? (selected.kind === "summary" ? "Waiting for this summary…" : "Reading this message…")
              : "This message has no text."}</p>
          {selected.children.length > 0 && (
            <div className="skull-reader-children">
              {selected.children.map((child) => (
                <button key={child.id} type="button" onClick={() => selectNode(child)}>
                  <b>{child.label}</b>
                  <small>{child.text.replace(/\s+/g, " ").trim().slice(0, 100) || (child.loaded === false ? "waiting for its text…" : "no text")}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type PendingPic = { url: string; remove: () => void };
let pendingPics: PendingPic[] = [];
const pendingPicSubs = new Set<() => void>();

export function setPendingPics(pics: PendingPic[]): void {
  pendingPics = pics;
  for (const sub of pendingPicSubs) sub();
}

// Pending attachments are a real ImageGeneration preview, not a flat <img>.
function PicsIsland(): React.ReactElement | null {
  const pics = useSyncExternalStore(
    (cb) => { pendingPicSubs.add(cb); return () => { pendingPicSubs.delete(cb); }; },
    () => pendingPics,
    () => pendingPics,
  );
  const lite = useMemo(() => isLite(), []);
  const webgl = useMemo(() => hasWebgl(), []);
  if (pics.length === 0) return null;
  return (
    <div className="pics-react">
      {pics.map((p) => (
        <button type="button" className="pic-pending" key={p.url} onClick={p.remove} title="Remove image">
          {!lite && webgl ? (
            <ImageGeneration preset="pixels-organic" images={[p.url]} autoReveal>
              <span className="pic-image" />
            </ImageGeneration>
          ) : (
            <img src={p.url} alt="" />
          )}
        </button>
      ))}
    </div>
  );
}

function GalleryIsland(): React.ReactElement | null {
  const open = useGallery();
  return open ? <Gallery onClose={() => setGallery(false)} /> : null;
}

let mounted = false;
export function mountShell(): void {
  if (mounted) return;
  mounted = true;
  const mount = (id: string, node: React.ReactElement): Root | null => {
    const el = document.getElementById(id);
    if (el === null) return null;
    const root = createRoot(el);
    root.render(node);
    return root;
  };
  mount("fx-brand", <BrandIsland />);
  mount("fx-activity", <ActivityIsland />);
  mount("fx-composer", <ComposerIsland />);
  mount("pics", <PicsIsland />);
  mount("fx-send", <SendIsland />);
  mount("fx-welcome", <WelcomeIsland />);
  mount("fx-skull", <SkullIsland />);
}
