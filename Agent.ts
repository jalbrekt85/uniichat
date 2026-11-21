// Agent
// =====
// claude-api, zai-api and openai-api in Unii's own loop; a Wire
// (Anthropic.ts, Zai.ts, OpenAI.ts) shapes requests and reads streams. Each step sends every
// item and streams one output; tool calls run in order, a message sent
// mid-run follows the next results, and the call ends at a step with no
// tools and nothing sent. A request goes again, TRIES times at most,
// after its retry-after or a doubling wait, for a passing reason (`busy`:
// no connection, a retry status, a stream error, cut short or silent for
// the wire's `idle`), dropping what it streamed. A request that yields
// (an import's summary, AskAI.ts) sends nothing while one that doesn't
// (a turn's, a chat's summary, which a turn waits on) waits on its busy
// model: the room a busy vendor has goes to the chats first, and many
// imports never starve every chat of the summaries its next turn needs.
// An import asks a busy model again by one request at a time, the rest
// waiting on it, so imports share what room is left alike, however many
// requests each runs.
// A busy model is logged as its first request asks again and as its
// last is done, never each try (a storm logged ~600 lines a second).
// A call ends answered
// (`fail`: the model's answer failed, a refusal or a stop reason: its
// input's doing) or not: `terminal`, the vendor's (billing, auth, an
// invalid request: the request refused for good — asked again, it fails
// alike); `down`, the vendor's (busy past TRIES); `lost`, ours (a stop,
// its payer's refusal or cut), saying why. A vendor's why (`busy`,
// `down`, `terminal`) reaches the chat whole — the exact status and
// message, in each retry's thought and in the call's end (a self-hosted
// server acts on them; nothing is swallowed). A stop ends the call at
// once; a paid one's
// request is read on to its end, out of sight, and billed whole (a
// stream cut short is billed what it read: Agent.used), a free one's is
// cut. A paid request is booked first (worst, Bill: AskAI.ts), then takes
// its place in single flight (AskAI.wait).

import { AskAI, type Grant, type Cost, type Ask, type Block, type Flight, type Try, type End, type Event, type Img, type Kind, type Say } from "./AskAI.ts";
import { Anthropic } from "./Anthropic.ts";
import { OpenAI } from "./OpenAI.ts";
import { Zai } from "./Zai.ts";
import { Local } from "./Local.ts";
import { Price, type Usage } from "./Price.ts";
import { live_push } from "./View.ts";
import { Machine, type Spec } from "./Machine.ts";
import * as config from "./Config.ts";
import * as Debug from "./Debug.ts";

// Types
// =====

export type Out = { text: string; fail: boolean; imgs?: Img[] };

export type Tool = Spec;

// what a request's stream read: the bytes of its output, and whether it
// ended (its last event read, its usage all told)
export type Read = { bytes: number; done: boolean; first?: number };

// a running call: the messages sent mid-run not taken yet
type Run = {
  ask   : Ask;
  on    : (ev: Event) => void;
  sent  : Say[];
  abort : AbortController;
  end   : End;
  hooks?: Ask["hooks"];
  inputTokens?: number;
  bodyBytes?: number;
  itemsBytes?: number;
};

export type Back = { id: string; out: Out };

// a room at a busy model, a model's or an import's (AskAI.ts `yields`):
// the requests asking again that hold it (a model's: those that don't
// yield; an import's: the one asking for all its requests), and those
// waiting till none does; a model's counts all its requests asking
// again too, logged as they go from none to some and back
type Room = { busy: number; asking: number; wait: Array<() => void> };

export type Item =
  | { $: "User"; parts: Block[]; imgs: Img[] } // user text, images
  | { $: "Turn"; out: unknown[] }             // the model's output, as its API gave it
  | { $: "Back"; backs: Back[] };             // tool results

// a tool call: its input (null: not JSON)
export type Use = { id: string; name: string; input: unknown };

export type Entry = { kind: Kind; text: string; of?: string };

// note: what it did other than asked
export type Step = {
  out     : unknown[];
  uses    : Use[];
  entries : Entry[];
  stop    : "done" | "tools" | "again" | "busy" | "down" | "lost" | "fail" | "terminal";
  why     : string;
  note    : string;
};

export type Emit = (kind: Kind, text: string, fresh?: boolean) => void;

// an API: its key's name in config.KEYS, a body's input tokens as it
// counts them (null: not told), and how its stream reads into a step (S:
// what it read so far)
export type Wire<S> = {
  key     : string;
  idle    : number;
  url     : string;
  headers : (key: string, ask: Ask) => Record<string, string>;
  body    : (ask: Ask, items: Item[], tools: Tool[], max: number) => unknown;
  count   : (key: string, ask: Ask, body: unknown) => Promise<number | null>;
  start   : (ask: Ask) => S;
  read    : (st: S, ev: any, on: Emit) => boolean;
  begun   : (ev: any) => boolean;
  step    : (st: S, ask: Ask) => Step;
  usage   : (st: S) => Usage;
};

// Constants
// =========

// a request's most output tokens: the models' own cap (less, if a paid
// one's credit pays for less: Bill)
const MAX   = 128000;
export const TRIES = 8;

// what a call the vendor never answered says
const BUSY  = "the AI service is busy or unavailable right now";

// the most tokens a model reads an image as (scaled to 1568 px at most),
// and a web search's results are booked as (0.1k to 8k)
const PIC    = 4096;
const RESULT = 5000;

// what a request on a free server is let write: all
const FREE: Grant = { max: MAX, cut: null, end: () => {} };

// the rooms held or waited on, by model, or model and import (Agent.step)
const ROOMS = new Map<string, Room>();

// the requests sent whose answers are not read to their end: a process
// ends only once none is (Server.ts Main.leave), as a paid one goes on
// after a stop and is billed only at its end
export const READING = { n: 0 };

// Agent
// =====

export namespace Agent {

  // the main turn's live conversation, for the debug endpoint: the exact
  // items the model is being sent while the turn runs. A subagent's loop
  // (any tag but "main") never takes this slot; the last main turn's
  // snapshot stays after it ends, marked done.
  export type Live = {
    at: number;
    tag: string;
    model: string;
    step: number;
    done: boolean;
    system: string;
    tools: unknown[];
    items: Item[];
    // in the last request built
    requestBytes?: number;
    inputTokens?: number;
    inputUncached?: number;
    cacheRead?: number;
    cacheWrite?: number;
    firstHash?: string;
    firstBytes?: number;
    prefixHash?: string;
    packetHashes?: string[];
    sentKinds?: string[];
    sentCount?: number;
    prefixStable?: boolean;
    packetsStable?: boolean;
    lastMakeAt?: number;
    makeSig?: string;
    // eviction, at the last check
    promptTokens?: number;
    promptEstimate?: number;
    window?: number;
    trigger?: number;
    target?: number;
    pairs?: number;
    packets?: number;
    evictions?: number;
    evictedIds?: string[];
    evictedAt?: number;
    summaryNote?: string;
    summaryNoteBytes?: number;
    summaryWaitMs?: number;
  };
  let LIVE: Live | null = null;

  export function live(): Live | null {
    return LIVE;
  }

  export function itemsBytes(items: Item[]): number {
    return items.reduce((n, item) => n + Buffer.byteLength(JSON.stringify(item)), 0);
  }

  export function preview(item: Item): string {
    if (item.$ === "User") {
      return item.parts.map((part) => part.text).join("\n").slice(0, 500);
    }
    if (item.$ === "Turn") {
      return JSON.stringify(item.out).slice(0, 500);
    }
    return item.backs.map((back) => back.out.text).join("\n").slice(0, 500);
  }

  // what /api/status shows without the full text: per item kind and bytes
  export function liveSummary(): object | null {
    const live = LIVE;
    if (live === null) {
      return null;
    }
    let itemsBytes = 0;
    const counts: Record<string, number> = {};
    const items = live.items.map((item) => {
      const bytes = Buffer.byteLength(JSON.stringify(item));
      itemsBytes += bytes;
      counts[item.$] = (counts[item.$] ?? 0) + 1;
      return { kind: item.$, bytes, preview: Agent.preview(item) };
    });
    const systemBytes = Buffer.byteLength(live.system ?? "");
    const toolsBytes = Buffer.byteLength(JSON.stringify(live.tools));
    return {
      at: live.at,
      tag: live.tag,
      model: live.model,
      step: live.step,
      done: live.done,
      systemBytes,
      toolsBytes,
      itemsBytes,
      totalBytes: systemBytes + toolsBytes + itemsBytes,
      counts,
      items,
      requestBytes: live.requestBytes ?? null,
      inputTokens: live.inputTokens ?? null,
      inputUncached: live.inputUncached ?? null,
      cacheRead: live.cacheRead ?? null,
      cacheWrite: live.cacheWrite ?? null,
      firstHash: live.firstHash ?? null,
      firstBytes: live.firstBytes ?? null,
      prefixHash: live.prefixHash ?? null,
      packetHashes: live.packetHashes ?? [],
      sentKinds: live.sentKinds ?? [],
      sentCount: live.sentCount ?? null,
      prefixStable: live.prefixStable ?? null,
      packetsStable: live.packetsStable ?? null,
      lastMakeAt: live.lastMakeAt ?? null,
      makeSig: live.makeSig ?? null,
      promptTokens: live.promptTokens ?? null,
      promptEstimate: live.promptEstimate ?? null,
      window: live.window ?? null,
      trigger: live.trigger ?? null,
      target: live.target ?? null,
      pairs: live.pairs ?? null,
      packets: live.packets ?? null,
      evictions: live.evictions ?? 0,
      evictedIds: live.evictedIds ?? [],
      evictedAt: live.evictedAt ?? null,
      summaryNote: (live.summaryNote ?? "").slice(0, 1000),
      summaryNoteBytes: live.summaryNoteBytes ?? 0,
      summaryWaitMs: live.summaryWaitMs ?? null,
    };
  }

  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const run: Run = { ask, on, sent: [], abort: new AbortController(), end, hooks: ask.hooks };
    const send = (say: Say) => run.sent.push(say);
    const stop = () => {
      end.text = "stopped";
      run.abort.abort();
    };
    const done = (async () => {
      try {
        if (ask.vendor === "claude-api") {
          await Agent.loop(Anthropic.wire, run);
        } else if (ask.vendor === "zai-api") {
          await Agent.loop(Zai.wire, run);
        } else if (ask.vendor === "local-api") {
          await Agent.loop(Local.wire, run);
        } else {
          await Agent.loop(OpenAI.wire, run);
        }
      } catch (err: any) {
        end.text ||= err.message;
      }
      end.ok   = end.ok && !run.abort.signal.aborted;
      end.left = run.sent;
      return end;
    })();
    return { send, stop, done };
  }

  export async function loop<S>(wire: Wire<S>, run: Run): Promise<void> {
    const { ask, on, end } = run;
    const signal = run.abort.signal;
    const key = wire.key === "local" ? Local.key() : config.KEYS[wire.key];
    if (!key && wire.key !== "local") {
      throw new Error("no API key: set " + wire.key.toUpperCase() + "_API_KEY");
    }
    Debug.record("agent", ask.tag ?? "main", {
      phase: "server-start",
      server: ask.server !== "",
      blocks: ask.blocks.length,
    });
    const tools = await Agent.server(run);
    Debug.record("agent", ask.tag ?? "main", {
      phase: "server-done",
      tools: tools.length,
    });
    const parts = ask.blocks.filter((b) => b.text !== "");
    const items: Item[] = [{ $: "User", parts, imgs: ask.imgs ?? [] }];
    type Pair = { turn: Item; back: Item; ids: string[] };
    let packets: Item[] = [];
    let pairs: Pair[] = [];
    // the note that stands in for evicted pairs, once one exists
    let reminder: Item | null = null;
    const make = (max: number) => {
      const first = items[0];
      const sent: Item[] = [first, ...packets];
      const firstHash = String(Bun.hash(JSON.stringify(first)));
      const prefixHash = firstHash;
      const packetHashes = packets.map((packet) => String(Bun.hash(JSON.stringify(packet))));
      const body = wire.body(ask, sent, tools, max);
      run.itemsBytes = Agent.itemsBytes(items);
      if (LIVE !== null && LIVE.items === items) {
        const live = LIVE;
        const sentHash = String(Bun.hash(JSON.stringify(sent)));
        const same = live.makeSig === sentHash;
        const stable = same
          ? (live.prefixStable ?? true)
          : (live.prefixHash === undefined || (live.firstHash === firstHash && live.prefixHash === prefixHash));
        const packetsStable = same
          ? (live.packetsStable ?? true)
          : (live.packetHashes === undefined || live.packetHashes.every((hash, k) => packetHashes[k] === hash));
        Object.assign(live, {
          firstHash,
          firstBytes: Buffer.byteLength(JSON.stringify(first)),
          prefixHash,
          packetHashes,
          sentKinds: sent.map((item) => item.$),
          sentCount: sent.length,
          prefixStable: stable,
          packetsStable,
          pairs: pairs.length,
          packets: packets.length,
          lastMakeAt: Date.now(),
          makeSig: sentHash,
        });
      }
      return body;
    };
    // Over 80% of the model's window, remove the oldest tool pairs until
    // the prompt is at or under 50%. The pair is gone from the items list;
    // the tree's lines for it go back into the items list as a note, where
    // the pair was, so the model is told what left its context.
    const evict = async (): Promise<void> => {
      const tag = run.ask.tag ?? "main";
      const body = run.bodyBytes;
      const lastItems = run.itemsBytes;
      if (body === undefined || body <= 0 || lastItems === undefined) {
        if (tag === "main") {
          Debug.record("evict", tag, {
            phase: "skip",
            reason: "no-measure",
            bodyBytes: body ?? null,
            itemsBytes: lastItems ?? null,
            promptTokens: run.inputTokens ?? null,
          });
        }
        return;
      }
      const input = run.inputTokens;
      if (input === undefined || input <= 0) {
        throw new Error("No input-token count from the model: cannot measure the prompt to evict.");
      }
      const window = run.hooks?.window?.();
      if (window === null || window === undefined || window <= 0) {
        if (tag === "main") {
          throw new Error("The model's context window is unknown; refusing to evict blind.");
        }
        return;
      }
      const ratio = input / body;
      let estimate = input + (Agent.itemsBytes(items) - lastItems) * ratio;
      const live = LIVE !== null && LIVE.items === items ? LIVE : null;
      if (live !== null) {
        Object.assign(live, {
          promptTokens: input,
          promptEstimate: estimate,
          window,
          trigger: window * 0.8,
          target: window * 0.5,
          pairs: pairs.length,
          packets: packets.length,
        });
      }
      if (estimate <= window * 0.8) {
        return;
      }
      const before = estimate;
      // Only pairs whose two summaries already exist are evicted. A pair
      // whose summaries are missing stays in the items list and is queued
      // in the compactor's real work queue; the main turn does not wait.
      const ready: Pair[] = [];
      const notes: string[] = [];
      let missing: string[] | null = null;
      for (const pair of pairs) {
        if (estimate <= window * 0.5) {
          break;
        }
        const note = run.hooks?.summary?.([...pair.ids]);
        if (note === undefined || note === null) {
          missing = [...pair.ids];
          break;
        }
        ready.push(pair);
        notes.push(note);
        estimate -= Agent.itemsBytes([pair.turn, pair.back]) * ratio;
      }
      // the decision, cut or not, is on disk: an overflow later must be
      // explainable from this record instead of from memory
      Debug.record("evict", tag, {
        phase: "decision",
        promptTokens: input,
        bodyBytes: body,
        itemsBytes: lastItems,
        itemsNow: Agent.itemsBytes(items),
        estimateBefore: before,
        estimateAfter: estimate,
        window,
        trigger: window * 0.8,
        target: window * 0.5,
        pairs: pairs.length,
        ready: ready.length,
        missing,
        evicted: ready.flatMap((pair) => pair.ids),
        outcome: ready.length === 0 ? "none" : estimate <= window * 0.5 ? "full" : "partial",
      });
      if (ready.length === 0) {
        return;
      }
      const note = notes.join("\n\n");
      if (live !== null) {
        live.summaryWaitMs = 0;
        live.summaryNote = note;
        live.summaryNoteBytes = Buffer.byteLength(note);
      }
      if (run.abort.signal.aborted) {
        return;
      }
      if (note.trim() === "") {
        throw new Error("The compactor produced no summary for the evicted steps.");
      }
      // the tree's lines for the dropped pairs go back into the prompt at
      // the position the pairs held; a later eviction adds to the same note
      if (reminder !== null) {
        (reminder as { parts: Block[] }).parts[0].text += "\n\n" + note;
      } else {
        reminder = {
          $: "User",
          parts: [{ text: "Dropped steps:\n\n" + note, mark: false }],
          imgs: [],
        };
        packets = [reminder, ...packets];
      }
      const drop = new Set<Item>(ready.flatMap((pair) => [pair.turn, pair.back]));
      packets = packets.filter((packet) => !drop.has(packet));
      pairs = pairs.filter((pair) => !ready.includes(pair));
      items.splice(0, items.length, items[0], ...packets);
      if (live !== null) {
        live.evictions = (live.evictions ?? 0) + 1;
        live.evictedIds = ready.flatMap((pair) => pair.ids);
        live.evictedAt = Date.now();
        live.pairs = pairs.length;
        live.packets = packets.length;
        live.promptEstimate = estimate;
      }
    };
    let stepNo = 0;
    const used = new Map<string, number>();
    if ((ask.tag ?? "main") === "main") {
      LIVE = { at: Date.now(), tag: "main", model: ask.model, step: 0, done: false, system: ask.system ?? "", tools, items };
    }
    try {
    while (!signal.aborted) {
      await evict();
      stepNo += 1;
      if (LIVE !== null && LIVE.items === items) {
        LIVE.step = stepNo;
        LIVE.at = Date.now();
        LIVE.done = false;
      }
      const step = await Agent.step(wire, run, key, make, items);
      Debug.record("agent", ask.tag ?? "main", {
        phase: "step",
        step: stepNo,
        items: items.length,
        itemsBytes: Agent.itemsBytes(items),
        tools: tools.length,
        blocks: ask.blocks.length,
        entries: step.entries.length,
        uses: step.uses.length,
        stop: step.stop,
        why: (step.why ?? "").slice(0, 500),
        sent: run.sent.length,
        model: ask.model,
        effort: ask.effort,
      });
      for (const entry of step.entries) {
        on({ $: "Entry", ...entry });
      }
      if (step.stop === "down" || step.stop === "lost" || step.stop === "fail" || step.stop === "terminal") {
        end.draft = step.stop === "fail"
          ? step.entries.filter((e) => e.kind === "unii").map((e) => e.text).join("")
          : "";
        end.text ||= step.why || BUSY; // the vendor's words, always: nothing is swallowed
        end.stop = step.stop;
        return;
      }
      const turn: Item = { $: "Turn", out: step.out };
      items.push(turn);
      end.note = step.note || end.note;
      if (step.stop === "again") {
        packets.push(turn);
        continue;
      }
      const runUse = async (use: Use): Promise<Back> => {
        const sig = use.name + ":" + JSON.stringify(use.input ?? {});
        const n = (used.get(sig) ?? 0) + 1;
        used.set(sig, n);
        const out = n > 3
          ? { text: "The same tool call was already run " + (n - 1) + " times with this exact input. Do not repeat it; try a different command or finish.", fail: true }
          : await Agent.use(run, tools, use);
        on({ $: "Entry", kind: "echo", text: (out.fail ? "error: " : "") + out.text, of: use.id });
        return { id: use.id, out };
      };
      const backs: Back[] = [];
      for (const use of step.uses) {
        if (signal.aborted) {
          return;
        }
        backs.push(await runUse(use));
      }
      if (signal.aborted) {
        return;
      }
      const says = run.sent.splice(0);
      const replies = step.entries.filter((e) => e.kind === "unii");
      const text = replies.map((e) => e.text).join("\n\n");
      // a local model without tool schemas may write the call as text
      if (backs.length === 0 && says.length === 0 && text.includes("<tool_call>")) {
        for (const use of Agent.xml(text)) {
          backs.push(await runUse(use));
        }
        if (backs.length > 0) {
          const back: Item = { $: "Back", backs };
          items.push(back);
          packets.push(turn, back);
          pairs.push({ turn, back, ids: backs.map((entry) => entry.id) });
          continue;
        }
      }
      if (backs.length === 0 && says.length === 0) {
        end.ok   = true;
        end.text = text;
        return;
      }
      for (const say of says) {
        on({ $: "Entry", kind: "user", text: say.text });
      }
      let back: Item | null = null;
      if (backs.length > 0) {
        back = { $: "Back", backs };
        items.push(back);
      }
      packets.push(turn);
      if (back !== null) {
        packets.push(back);
        pairs.push({ turn, back, ids: backs.map((entry) => entry.id) });
      }
      if (says.length > 0) {
        const parts = says.filter((say) => say.text !== "").map((say) => ({ text: say.text, mark: false }));
        const imgs = says.flatMap((say) => say.imgs);
        const said: Item = { $: "User", parts, imgs };
        items.push(said);
        packets.push(said);
      }
    }
    } finally {
      if (LIVE !== null && LIVE.items === items) {
        LIVE.done = true;
        LIVE.at = Date.now();
        // the turn's final context state, on disk like every decision
        Debug.record("evict", ask.tag ?? "main", {
          phase: "turn",
          evictions: LIVE.evictions ?? 0,
          evictedIds: LIVE.evictedIds ?? [],
          promptTokens: LIVE.promptTokens ?? null,
          promptEstimate: LIVE.promptEstimate ?? null,
          window: LIVE.window ?? null,
          trigger: LIVE.trigger ?? null,
          target: LIVE.target ?? null,
          pairs: LIVE.pairs ?? 0,
          packets: LIVE.packets ?? 0,
        });
      }
    }
  }

  // make: the request's body, writing `max` tokens at most. Asking again,
  // it holds its room (Room): its model's, or its import's, which one
  // request holds at a time while the rest wait on it, so each import
  // has one request at a busy model however many it runs, and imports
  // share its room alike
  export async function step<S>(wire: Wire<S>, run: Run, key: string, make: (max: number) => unknown, items: Item[]): Promise<Step> {
    const body = make(MAX);
    const cost = Agent.worst(run.ask, JSON.stringify(body), items, () => wire.count(key, run.ask, body));
    const signal = run.abort.signal;
    const model = run.ask.model;
    const own = run.ask.yields === undefined ? model : model + " " + run.ask.yields;
    let asking = false;
    try {
      for (let k = 1; !signal.aborted; k++) {
        await Agent.yielded(run, own, asking);
        const seen: Entry[] = [];
        const sent = Agent.request(wire, run, key, make, cost, seen);
        const stopped = new Promise<null>((done) => signal.addEventListener("abort", () => done(null), { once: true }));
        const got = await Promise.race([sent, stopped]);
        if (got === null) {
          return Agent.fail("stopped", seen);
        }
        const { res, step } = got;
        if (step.stop === "down" || step.stop === "terminal") {
          console.error(model + ": " + step.why.slice(0, 300));
        }
        if (step.stop === "terminal") {
          return step; // the vendor refused for good: asking again fails alike
        }
        if (step.stop === "busy") {
          console.log(`[agent] busy ${model} try ${k}: ${step.why.slice(0, 200)}`);
        }
        if (step.stop !== "busy" || k >= TRIES) {
          return step.stop === "busy" ? { ...step, stop: "down" } : step;
        }
        if (!asking && own !== model && (ROOMS.get(own)?.busy ?? 0) > 0) {
          continue;
        }
        if (!asking) {
          Agent.hold(model, own, step.why);
          asking = true;
        }
        const after = Number(res?.headers.get("retry-after") ?? "");
        const wait = after > 0 ? after : 2 ** k;
        run.on({ $: "Entry", kind: "mind", text: "The AI service is busy (" + step.why + "): asking again in " + wait + " s." });
        await Machine.nap(wait * 1000, signal);
      }
      return Agent.fail("stopped", []);
    } finally {
      if (asking) {
        Agent.free(model, own);
      }
    }
  }

  export function room(key: string): Room {
    const room = ROOMS.get(key) ?? { busy: 0, asking: 0, wait: [] };
    ROOMS.set(key, room);
    return room;
  }

  // a request asks `model` again, holding `own`, its model's room or its
  // import's; the model's first says why
  export function hold(model: string, own: string, why: string): void {
    if (Agent.room(model).asking++ === 0) {
      console.error(model + ": " + why.slice(0, 300) + ": its requests ask again");
    }
    Agent.room(own).busy += 1;
  }

  // ... and lets go of it, answered or not: the last frees those waiting
  export function free(model: string, own: string): void {
    const room = Agent.room(own);
    room.busy -= 1;
    if (room.busy === 0) {
      room.wait.splice(0).forEach((ok) => ok());
    }
    if (--Agent.room(model).asking === 0) {
      console.error(model + ": none asks again");
    }
    for (const key of [own, model]) {
      if (ROOMS.get(key)?.busy === 0 && ROOMS.get(key)?.asking === 0) {
        ROOMS.delete(key);
      }
    }
  }

  // a request that yields waits while a request that doesn't holds its
  // model's room, and while another holds its import's
  export async function yielded(run: Run, own: string, asking: boolean): Promise<void> {
    const keys = run.ask.yields === undefined ? [] : asking ? [run.ask.model] : [run.ask.model, own];
    for (;;) {
      const room = keys.map((key) => ROOMS.get(key)).find((room) => (room?.busy ?? 0) > 0);
      if (room === undefined || run.abort.signal.aborted) {
        return;
      }
      await new Promise<void>((ok) => {
        room.wait.push(ok);
        run.abort.signal.addEventListener("abort", () => ok(), { once: true });
      });
    }
  }

  // a request's most input cost: each byte of its text a token, an image
  // PIC tokens (exact: the tokens `count` tells, or those), all at the
  // dearest input price (a cache write), and its most web searches, each
  // RESULT tokens more; and an output token's, at a prompt that size (a
  // long one may cost more)
  export function worst(ask: Ask, json: string, items: Item[], count: () => Promise<number | null>): Cost {
    const imgs = items.flatMap((item) => (item.$ === "User" ? item.imgs : item.$ === "Back" ? item.backs.flatMap((b) => b.out.imgs ?? []) : []));
    const write = Buffer.byteLength(json) + imgs.reduce((n, img) => n + PIC - img.data.length, 0);
    const web = Price.cost(ask.model, { ...Price.usage(ask.speed), write: ask.searches * RESULT, searches: ask.searches });
    const at = (write: number, output: number) => Price.cost(ask.model, { ...Price.usage(ask.speed), write, output });
    const cost = (write: number, exact: Cost["exact"]): Cost => ({ input: at(write, 0) + web, token: (at(write, 1e6) - at(write, 0)) / 1e6, exact });
    return cost(write, async () => cost((await count()) ?? write, null));
  }

  // one request, sent once its payer let it through (Bill), then single
  // flight (AskAI.wait); then, if paid, read to the end of its stream
  // whether the call stops or not, and billed: its response, if any, and
  // step
  export async function request<S>(wire: Wire<S>, run: Run, key: string, make: (max: number) => unknown, cost: Cost, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
    const grant = run.ask.bill ? await run.ask.bill(cost, MAX) : { ...FREE, max: run.ask.max ?? FREE.max };
    if (typeof grant === "string") {
      return { res: null, step: Agent.fail(grant, []) };
    }
    const waited = Date.now();
    const flight = await Promise.race([
      AskAI.wait(run.ask),
      new Promise<null>((done) => setTimeout(() => done(null), 15000)),
    ]);
    if (flight === null) {
      Debug.record("agent", run.ask.tag ?? "main", {
        phase: "single-flight-timeout",
        ms: Date.now() - waited,
        model: run.ask.model,
      });
      return { res: null, step: Agent.fail("single-flight wait exceeded 15s", []) };
    }
    Debug.record("agent", run.ask.tag ?? "main", {
      phase: "single-flight",
      ms: Date.now() - waited,
      model: run.ask.model,
    });
    if (run.abort.signal.aborted) {
      flight.end();
      grant.end(null);
      return { res: null, step: Agent.fail("stopped", []) };
    }
    READING.n += 1;
    return Agent.send(wire, run, key, make(grant.max), grant, flight, seen).finally(() => (READING.n -= 1));
  }

  export async function send<S>(wire: Wire<S>, run: Run, key: string, body: unknown, grant: Grant, flight: Flight, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
    const idle = new AbortController();
    const timer = setTimeout(() => idle.abort(new Error("no word from the API in " + wire.idle / 1e3 + " s")), wire.idle);
    const st = wire.start(run.ask);
    const read: Read = { bytes: 0, done: false };
    const json = JSON.stringify(body);
    const started = Date.now();
    const bodyBytes = Buffer.byteLength(json);
    Debug.record("model", run.ask.tag ?? "other", {
      phase: "request-start",
      model: run.ask.model,
      effort: run.ask.effort,
      blocks: run.ask.blocks.length,
      bodyBytes,
      max: grant.max,
      cutoff: run.ask.cut ?? null,
    });
    let res: Response | null = null;
    let step: Step;
    run.hooks?.generating?.(true);
    try {
      res = await fetch(wire.url, {
        method  : "POST",
        headers : wire.headers(key, run.ask),
        body    : json,
        signal  : run.ask.bill ? idle.signal : AbortSignal.any([run.abort.signal, idle.signal]),
        timeout : false,
      } as RequestInit);
      Debug.record("model", run.ask.tag ?? "other", {
        phase: "response-start",
        model: run.ask.model,
        status: res.status,
        ms: Date.now() - started,
        bodyBytes,
      });
      const text = res.ok && res.body ? "" : await res.text();
      const why = text === "" ? "" : "HTTP " + res.status + ": " + Agent.reason(text);
      step = why === ""
        ? await Agent.stream(wire, run, res.body!, timer, seen, st, flight.begun, read)
        : Agent.fail(why, [], Agent.terminal(res, text) ? "terminal" : Agent.passing(res) ? "busy" : "down");
    } catch (err: any) {
      step = Agent.fail(err.message, [], "busy");
    } finally {
      run.hooks?.generating?.(false);
    }
    clearTimeout(timer);
    flight.end();
    const { vendor, model, effort, speed } = run.ask;
    const use = res?.ok ? Agent.used(wire.usage(st)) : null;
    // oMLX (and Anthropic) count the prompt in three parts: uncached input,
    // cache reads, cache writes. The prompt is their sum; input_tokens alone
    // is 0 on a prefix-cache hit.
    const promptTokens = use === null ? undefined : use.input + use.read + use.write;
    run.inputTokens = promptTokens !== undefined && promptTokens > 0 ? promptTokens : undefined;
    run.bodyBytes = bodyBytes;
    if (LIVE !== null && (run.ask.tag ?? "main") === "main") {
      LIVE.requestBytes = bodyBytes;
      LIVE.inputTokens = promptTokens;
      LIVE.inputUncached = use?.input;
      LIVE.cacheRead = use?.read;
      LIVE.cacheWrite = use?.write;
    }
    grant.end(use && { run: { vendor, model, effort, speed }, use });
    const cut = use !== null && use.output >= grant.max ? grant.cut : null;
    const final = cut === null ? step : Agent.fail(cut, seen);
    const done = Date.now();
    Debug.record("model", run.ask.tag ?? "other", {
      model,
      vendor,
      effort,
      speed,
      blocks: run.ask.blocks.length,
      blockBytes: run.ask.blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0),
      bodyBytes,
      max: grant.max,
      cutoff: run.ask.cut ?? null,
      status: res?.status ?? null,
      stop: final.stop,
      why: (final.why ?? "").slice(0, 500),
      inputTokens: use?.input ?? null,
      inputTotal: use === null ? null : use.input + use.read + use.write,
      outputTokens: use?.output ?? null,
      cacheRead: use?.read ?? null,
      cacheWrite: use?.write ?? null,
      firstMs: read.first === undefined ? null : read.first - started,
      decodeMs: read.first === undefined ? null : done - read.first,
      totalMs: done - started,
      decodeTokPerSec: read.first !== undefined && use !== null && done > read.first ? use.output / ((done - read.first) / 1000) : null,
      server: run.ask.server !== "",
    });
    return { res, step: final };
  }

  // a request's usage: the API's. No byte fallback. If the API did not
  // report a count, it stays missing and the eviction hard-errors.
  export function used(use: Usage): Usage {
    return use;
  }

  // a failed request's why: the API's message (Anthropic's and OpenAI's
  // errors are {error: {message}}), else the start of its body
  export function reason(body: string): string {
    try {
      const why = JSON.parse(body)?.error?.message;
      return typeof why === "string" ? why : body.slice(0, 2000);
    } catch {
      return body.slice(0, 2000);
    }
  }

  // whether the response is a terminal refusal. For 429s, z.ai's codes
  // (docs.z.ai/api-reference/api-code) split by what waiting can do:
  // the entitlement walls — no balance (1113), usage windows measured in
  // hours or days (1308, 1310, 1316-1321, their reset time in the
  // message), expired or absent plans (1309, 1314), models the plan
  // lacks (1311), fair-use holds (1313), wrong-product keys (1315) —
  // never clear in seconds, so one request, the words surfaced. The
  // rate limits (1302, 1305, any code unlisted) clear in seconds or
  // minutes: they back off. A terminal code wins over a stray
  // x-should-retry: true. Auth (1000-1005: 401) and invalid requests
  // (1210-1222, 1261, 1301: 400/403/404) are terminal by status alone
  export function terminal(res: Response, body: string): boolean {
    const code = (() => {
      try {
        return String(JSON.parse(body)?.error?.code ?? "");
      } catch {
        return "";
      }
    })();
    if (res.status === 429) {
      return ["1113", "1308", "1309", "1310", "1311", "1313", "1314", "1315", "1316", "1317", "1318", "1319", "1320", "1321"].includes(code);
    }
    return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409;
  }

  export function passing(res: Response): boolean {
    const should = res.headers.get("x-should-retry");
    const busy = [408, 409, 429].includes(res.status) || res.status >= 500;
    return should === "true" || (should !== "false" && busy);
  }

  // seen: what streamed, as told to the call (none once it stopped); st:
  // what it read, its usage; begun: its response began (Flight)
  export async function stream<S>(wire: Wire<S>, run: Run, body: ReadableStream<Uint8Array>, timer: Timer, seen: Entry[], st: S, begun: () => void, read: Read): Promise<Step> {
    const ask = run.ask;
    let textBytes = 0;
    let cut = false;
    const on: Emit = (kind, text, fresh) => {
      const size = Buffer.byteLength(text);
      read.bytes += size;
      if (size > 0 && read.first === undefined) {
        read.first = Date.now();
      }
      if (kind === "unii") {
        textBytes += size;
        if (ask.cut !== undefined && textBytes >= ask.cut) {
          cut = true;
        }
      }
      if (!run.abort.signal.aborted) {
        live_push(seen, kind, text, fresh);
        run.on({ $: "Delta", kind, text, fresh });
      }
    };
    try {
      for await (const ev of Agent.events(body)) {
        timer.refresh();
        if (wire.begun(ev)) {
          begun();
        }
        if (wire.read(st, ev, on)) {
          read.done = true;
          const step = wire.step(st, ask);
          return step.stop === "fail" || step.stop === "busy" ? Agent.fail(step.why, seen, step.stop) : step;
        }
        if (cut) {
          read.done = true;
          const step = wire.step(st, ask);
          console.log(`[compactor] cutoff ${textBytes}B`);
          return step.stop === "fail" || step.stop === "busy" ? Agent.fail(step.why, seen, step.stop) : step;
        }
      }
      return Agent.fail("the stream ended early", seen, "busy");
    } catch (err: any) {
      return Agent.fail(err.message, seen, "busy");
    }
  }

  export function fail(why: string, seen: Entry[], stop: Step["stop"] = "lost"): Step {
    const mark = "\n[cut off: " + why.slice(0, 300) + "]";
    const entries = seen.filter((e) => e.text.trim()).map((e) => ({ kind: e.kind, text: e.text.trim() + mark }));
    return { out: [], uses: [], entries, stop, why, note: "" };
  }

  export async function* events(stream: ReadableStream<Uint8Array>) {
    for await (const line of AskAI.lines(stream)) {
      if (line.startsWith("data:") && line.slice(5).trim() !== "[DONE]") {
        yield JSON.parse(line.slice(5));
      }
    }
  }

  // null: not JSON
  export function parse(json: string): unknown {
    try {
      return JSON.parse(json || "{}");
    } catch {
      return null;
    }
  }

  // Tools
  // -----

  export async function use(run: Run, tools: Tool[], use: Use): Promise<Out> {
    const started = Date.now();
    const input = use.input;
    const inputBytes = Buffer.byteLength(JSON.stringify(input ?? {}));
    const log = (out: Out) => Debug.record("tool", run.ask.tag ?? "main", {
      tool: use.name,
      inputBytes,
      outputBytes: Buffer.byteLength(out.text),
      fail: out.fail,
      ms: Date.now() - started,
    });
    if (!tools.some((t) => t.name === use.name)) {
      const out = { text: "No tool " + use.name + ".", fail: true };
      log(out);
      return out;
    }
    if (input === null || typeof input !== "object") {
      const out = { text: "The input is not a JSON object.", fail: true };
      log(out);
      return out;
    }
    try {
      const out = await Agent.call(run, use.name, input);
      const full = { ...out, text: out.text || "(no output)" };
      log(full);
      return full;
    } catch (err: any) {
      const why = run.abort.signal.aborted ? "(stopped)" : err.message;
      const out = { text: why, fail: true };
      log(out);
      return out;
    }
  }

  // some local models write a tool call as text instead of a tool_use
  // block. Parse the common <tool_call> form so a dropped schema does not
  // turn a real tool request into a fake final answer.
  export function xml(text: string): Use[] {
    const uses: Use[] = [];
    let n = 0;
    const unescape = (s: string) => s
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    for (const call of text.matchAll(/<tool_call>\s*([A-Za-z0-9_.-]+)([\s\S]*?)<\/tool_call>/g)) {
      const input: Record<string, string> = {};
      for (const arg of call[2].matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g)) {
        input[unescape(arg[1]).trim()] = unescape(arg[2]);
      }
      uses.push({ id: "xml-" + Date.now() + "-" + n++, name: call[1], input });
    }
    return uses;
  }

  export async function server(run: Run): Promise<Tool[]> {
    if (!run.ask.server) {
      return [];
    }
    const started = Date.now();
    try {
      const list = await Agent.rpc(run, "tools/list", {});
      Debug.record("agent", run.ask.tag ?? "main", {
        phase: "tools-list",
        ms: Date.now() - started,
        tools: list.tools.length,
      });
      return list.tools.map((t: any) => ({ name: t.name, info: t.description, schema: t.inputSchema }));
    } catch (err: any) {
      Debug.record("agent", run.ask.tag ?? "main", {
        phase: "tools-list-error",
        ms: Date.now() - started,
        error: String(err?.message ?? err).slice(0, 500),
      });
      throw err;
    }
  }

  export async function call(run: Run, name: string, input: unknown): Promise<Out> {
    const res = await Agent.rpc(run, "tools/call", { name, arguments: input });
    const pics = res.content.filter((part: any) => part.type === "image");
    const imgs = pics.map((part: any) => ({ type: part.mimeType, data: part.data }));
    return { text: AskAI.show(res.content), fail: res.isError === true, imgs };
  }

  export async function rpc(run: Run, method: string, params: unknown): Promise<any> {
    const res = await fetch(run.ask.server, {
      method  : "POST",
      headers : { "content-type": "application/json" },
      body    : JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal  : AbortSignal.any([run.abort.signal, AbortSignal.timeout(10000)]),
      timeout : false,
    } as RequestInit);
    const msg = await res.json();
    if (msg.error) {
      throw new Error(method + ": " + msg.error.message);
    }
    return msg.result;
  }

}
