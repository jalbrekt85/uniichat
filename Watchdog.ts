// Watchdog
// ========
// A background reader of Unii's thoughts (glm-5.3-flash by config): as
// the turn's call emits them (Server.ts Chat.on: a mind entry, a step's
// thinking, shown never logged) they are held; past MIN bytes — or at a
// turn's end, that none is missed — one call at a time asks of the
// batch, as a compaction asks (the master's prompt, Server.ts
// Chat.share; its task marked "Watchdog:", the task and the thoughts
// each inside tags: data to judge, never a request), whether Unii is
// fixing a symptom where its cause is — a fix that acts at another
// layer, stacks a compensation, guards a misfire away, or builds
// before it knows — its reply capped at the
// wire (CUT tokens: a verdict is one word, the task itself never
// answered). A call that fails keeps its batch for the next (an outage
// delays, never skips). BAD: a [Watchdog] report reaches the chat as an
// agent's does
// (Tools.ts's reports, Server.ts Chat.take): between the running call's
// tool calls, else a new turn, telling Unii to stop and discuss with
// the user the foundational solution the whole repository wants. One
// report a turn; the thoughts themselves are never logged.

import * as fs from "node:fs";
import { AskAI, type Ask, type Bill, type Cost, type Grant, type Used } from "./AskAI.ts";
import { Memory } from "./Memory.ts";
import { Pick } from "./Pick.ts";
import { Chat } from "./Server.ts";
import * as config from "./Config.ts";

// Types
// =====

// the watchdog's state on a chat: the thoughts not checked and their
// bytes; a check under way, and how much of the buffer it took; a turn
// ended (what is left is checked, however little); reported this turn
export type Dog = {
  buf  : string[];
  bytes: number;
  run  : boolean;
  took : number;
  flush: boolean;
  fired: boolean;
};

// Constants
// =========

// a check starts past this many bytes of unchecked thought — 4 KB, a
// check every few thinking blocks, so the flash checks (which share the
// plan's rate limit with the chat) run a quarter as often; nothing is
// lost: the buffer holds every thought since the last check, a turn's
// end checks the rest, and each check judges a larger batch. The most
// held (a vendor outage: the oldest let go, the latest still checked)
const MIN  = 4096;
const MOST = 65536;

// of a check's input, the most of each of the user's messages; of its
// report, the most quoted of the batch
const WORDS = 1024;
const QUOTE = 600;

// past this many tokens the wire cuts a check's reply — thinking counts
// on this wire, so this is also the room a verdict has to think in
// (GLM thinks of its own accord; 3-60 tokens bought today's verdicts):
// a gross backstop only against the task being answered instead, the
// master prompt, its tags and its mark the first defense. A reply that
// fills it fails the call (AskAI.ts Grant.cut), its batch asked anew
const CUT = 2048;
const RAN = "the watchdog's reply ran past its cap";

// what a report says, its {quote} the batch's words
const CALL_OUT = `[Watchdog]
A background reviewer that reads your thoughts as you work has caught
you treating a symptom instead of its cause:

  "{quote}"

Stacked compensations are why proper development on this repository is
difficult. Make no more tool calls on this task. End your turn now and
talk to the user: name the layer where the damage actually originates,
and the foundational fix for the whole repository — the design it
wants, the invariants it should hold, how the existing code moves to
it — then ask the user to choose the scope. You never quietly layer
around a cause.`;

// Watchdog
// ========

export namespace Watchdog {

  export function dog(): Dog {
    return { buf: [], bytes: 0, run: false, took: 0, flush: false, fired: false };
  }

  // the watchdog's work as it happens, only in debug (config
  // watchdog_debug): the server's window and <dir>/watchdog.log
  function log(head: string, body: string = ""): void {
    if (!config.WATCHDOG_DEBUG) {
      return;
    }
    const line = "[" + new Date().toISOString() + " " + head + "]" + (body === "" ? "" : "\n" + body);
    console.log(line);
    fs.appendFileSync(config.DIR + "/watchdog.log", line + "\n");
  }

  // a thought of the turn's call: held, and a check started if enough
  // has gathered (a chat already reported waits for its turn's end)
  export function mind(chat: Chat, text: string): void {
    const dog = chat.dog;
    if (dog.fired || config.WATCHDOG === null) {
      return;
    }
    dog.buf.push(text);
    dog.bytes += Memory.bytes(text);
    while (!dog.run && dog.bytes > MOST) {
      dog.bytes -= Memory.bytes(dog.buf.shift()!);
    }
    log("mind +" + Memory.bytes(text) + "B, " + dog.bytes + "B unchecked", text);
    Watchdog.pump(chat);
  }

  // the turn ended: what thoughts are left are checked, however few,
  // that none is missed; one reported already starts the next turn clean
  export function turn_end(chat: Chat): void {
    const dog = chat.dog;
    if (dog.fired || config.WATCHDOG === null) {
      log("turn end, " + dog.bytes + "B unchecked" + (dog.fired ? ", reported" : ""));
      Object.assign(dog, Watchdog.dog());
      return;
    }
    dog.flush = true;
    log("turn end, " + dog.bytes + "B unchecked: checking");
    Watchdog.pump(chat);
  }

  // a check starts if none runs, past MIN bytes or (a turn ended)
  // whatever is left, one at a time, so a slow check batches what comes
  export function pump(chat: Chat): void {
    const dog = chat.dog;
    if (!dog.run && !dog.fired && (dog.bytes >= MIN || (dog.flush && dog.bytes > 0))) {
      Watchdog.check(chat);
    }
  }

  // what a check's reply may write (AskAI.ts Bill, the harness's own
  // cap): CUT tokens whatever its payer allows (none: free), a reply
  // that fills it failing as cut. Its end logs the use in debug: what a
  // verdict cost against the cap
  export function bill(chat: Chat): Bill {
    const pay = chat.mem.pay?.("watchdog", "dog");
    return async (cost: Cost, cap: number) => {
      const most = Math.min(cap, CUT);
      const grant: Grant | string = pay === undefined
        ? { max: most, cut: null, end: (used: Used | null) => { if (used !== null) { log("use", used.use.output + " tokens out"); } } }
        : await pay(cost, most);
      return typeof grant === "string" ? grant : { ...grant, max: Math.min(grant.max, most), cut: grant.cut ?? RAN };
    };
  }

  // one check of the buffer's start, holding the chat (its posts) till
  // it lands: a report may fire past the turn's end, into a chat no
  // view holds. A call that fails keeps its batch: the next thought, or
  // the turn's end, asks anew
  export function check(chat: Chat): void {
    const run = config.WATCHDOG!;
    const dog = chat.dog;
    dog.run = true;
    dog.took = dog.buf.length;
    const batch = dog.buf.join("\n\n");
    log("check, " + dog.took + " thought(s), " + Memory.bytes(batch) + "B");
    chat.posts += 1;
    const ask: Ask = {
      ...Chat.share(chat),
      ...Pick.ask(run),
      blocks  : [{ text: Watchdog.text(chat, batch), mark: false }],
      bill    : Watchdog.bill(chat),
    };
    AskAI.ask(ask, () => {}).done.then((end) => {
      dog.run = false;
      log("answer", end.ok ? "answered: " + end.text.trim() : "failed: " + end.text);
      if (end.ok) {
        dog.bytes -= dog.buf.slice(0, dog.took).reduce((n, t) => n + Memory.bytes(t), 0);
        dog.buf.splice(0, dog.took);
        if (/^\W*BAD\b/i.test(end.text)) {
          Watchdog.fire(chat, batch);
        }
        if (dog.buf.length === 0) {
          dog.flush = false;
        }
        Watchdog.pump(chat);
      }
      chat.posts -= 1;
      Chat.free(chat);
    });
  }

  // a check's task (its instruction first, as a compaction's is, then
  // the data inside tags: the user's LAST word alone, with the standing
  // goal if one is set — never their older words, whose heat is what a
  // judge misreads as the standard — then Unii's own last reply as its
  // plan for the work, then the thoughts since the last check)
  export function text(chat: Chat, batch: string): string {
    const mem = chat.mem;
    let task: string | null = null;
    let plan: string | null = null;
    for (let i = mem.count - 1; i >= Math.max(0, mem.count - 60) && (task === null || plan === null); i--) {
      const root = Memory.message(mem, i);
      if (root === null) {
        break;
      }
      if (task === null && root.kind === "user") {
        task = root.text.slice(0, WORDS);
      }
      if (plan === null && root.kind === "unii") {
        plan = root.text.slice(0, WORDS);
      }
    }
    const words = (mem.goal !== null ? "Standing goal: " + mem.goal + "\n" : "") + (task ?? "(not read)");
    return "Watchdog: judge Unii's thoughts since the last check, below, against its task and plan: reply BAD or OK first, then at most one sentence quoting the words that decided it.\n<task>\n" + words + "\n</task>\n<plan>\n" + (plan ?? "(not read)") + "\n</plan>\n<thoughts>\n" + batch + "\n</thoughts>";
  }

  // a BAD batch: the report, logged and taken as an agent's report is
  // (Server.ts Chat.report): between the running call's tool calls,
  // else as a new turn
  export function fire(chat: Chat, batch: string): void {
    chat.dog.fired = true;
    if (Chat.chats.get(chat.acct.user) !== chat) {
      return;
    }
    const flat = Memory.flat(batch);
    const quote = flat.slice(0, QUOTE) + (flat.length > QUOTE ? "…" : "");
    log("fire: BAD", quote);
    const text = CALL_OUT.replace("{quote}", () => quote);
    Chat.hold(chat, () => {
      chat.posts += 1;
      const msg = Chat.chats.get(chat.acct.user) !== chat ? null : Chat.push(chat, null, "work", text);
      if (msg !== null) {
        Chat.take(chat, msg);
      }
      chat.posts -= 1;
      Chat.change(chat);
      Chat.free(chat);
    });
  }

}
