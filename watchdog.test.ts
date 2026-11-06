// Watchdog test
// =============
// `bun test watchdog.test.ts`. A turn's thoughts (mind entries, Server.ts
// Chat.on) reach the watchdog (Watchdog.ts), its checks and the reports
// it fires against a faked AskAI (Server.test.ts's way: a process of
// its own, Chat.open with AskAI.ask replaced, nothing sent). BAD
// reports between the running call's tool calls as "[Watchdog]"; OK
// reports nothing; thoughts under Watchdog's MIN batch till the turn's
// end; one report a turn; a turn without thoughts asks nothing; a
// check's reply is capped by its bill and wrapped input, and one that
// fails keeps its batch. A check runs on the master's prompt, as a
// compaction does, told by its task's "Watchdog:" mark (a report, too
// long for a node, asks a compaction call of its own).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// the cases, each on a chat of its own (Config is read once a process),
// told as one JSON line
const RUN = `
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const calls: any[] = [];
const sent: string[] = [];
const dog = (ask: any) => ask.blocks[0]?.text.startsWith("Watchdog:");
AskAI.ask = (ask: any, on: any) => {
  const [call, feed] = AskAI.tie(on, ask.bill, (say: any) => sent.push(say.text), () => {});
  calls.push({ ask, feed });
  return call;
};
const turn = () => calls.find(({ ask }) => !dog(ask))!;
const check = () => calls.filter(({ ask }) => dog(ask)).at(-1);
const dogs = () => calls.filter(({ ask }) => dog(ask)).length;
const think = (text: string) => turn().feed.on({ $: "Entry", kind: "mind", text });
const end = (feed: any, text: string) => feed.end({ ok: true, text, left: [] });
const chat_open = (id: string) => Chat.open({ id, name: id });
const out: any = {};

// BAD: the check asks of the task and the thoughts, on the flash pick;
// the report reaches the running call and the log; nothing more that turn
{
  const chat = chat_open("w1");
  Chat.take(chat, Chat.push(chat, null, "user", "rewrite the parser properly"));
  await Bun.sleep(20);
  think("I could fix the grammar properly, but that is a big refactor; I will just patch the caller with a try/catch and move on. ".repeat(40));
  await Bun.sleep(20);
  const ask = check()!.ask;
  out.bad = {
    master: ask.system === turn().ask.system,
    model: ask.model,
    task: ask.blocks[0].text.includes("rewrite the parser properly"),
    thought: ask.blocks[0].text.includes("patch the caller with a try/catch"),
  };
  end(check()!.feed, "BAD");
  await Bun.sleep(20);
  out.bad.report = sent.some((text) => text.startsWith("[Watchdog]"));
  out.bad.logged = Memory.message(chat.mem, chat.mem.count - 1)!.kind;
  end(turn().feed, "done");
  await Bun.sleep(20);
  out.bad.dogs = dogs();
}

// OK: nothing sent, nothing logged of it
{
  calls.length = 0;
  sent.length = 0;
  const chat = chat_open("w2");
  Chat.take(chat, Chat.push(chat, null, "user", "add the feature fully"));
  await Bun.sleep(20);
  think("I will build this properly: the types first, then the store, then the callers. ".repeat(60));
  await Bun.sleep(20);
  end(check()!.feed, "OK");
  await Bun.sleep(20);
  end(turn().feed, "done");
  await Bun.sleep(20);
  out.ok = { dogs: dogs(), report: sent.length, calls: calls.length };
}

// under MIN: the thoughts batch till the turn's end, one check of both
{
  calls.length = 0;
  const chat = chat_open("w3");
  Chat.take(chat, Chat.push(chat, null, "user", "plan it"));
  await Bun.sleep(20);
  think("alpha thought ".repeat(20));
  think("beta thought ".repeat(20));
  await Bun.sleep(20);
  out.under = { dogs: dogs() };
  end(turn().feed, "done");
  await Bun.sleep(20);
  const ask = check()!.ask;
  out.under.flushed = dogs();
  out.under.both = ask.blocks[0].text.includes("alpha thought") && ask.blocks[0].text.includes("beta thought");
  end(check()!.feed, "OK");
  await Bun.sleep(20);
}

// one report a turn: a thought after it asks nothing
{
  calls.length = 0;
  sent.length = 0;
  const chat = chat_open("w4");
  Chat.take(chat, Chat.push(chat, null, "user", "quick hack?"));
  await Bun.sleep(20);
  think("simplest thing: special-case the input and ship it. ".repeat(80));
  await Bun.sleep(20);
  end(check()!.feed, "BAD");
  await Bun.sleep(20);
  out.once = { report: sent.filter((text) => text.startsWith("[Watchdog]")).length };
  think("more shortcut thinking, to be ignored entirely. ".repeat(20));
  await Bun.sleep(20);
  end(turn().feed, "done");
  await Bun.sleep(20);
  out.once.dogs = dogs();
}

// a turn without thoughts asks nothing
{
  calls.length = 0;
  const chat = chat_open("w5");
  Chat.take(chat, Chat.push(chat, null, "user", "just talk"));
  await Bun.sleep(20);
  end(turn().feed, "a reply");
  await Bun.sleep(20);
  out.silent = { dogs: dogs(), calls: calls.length };
}

// a check's reply is capped at the wire (its bill: CUT tokens, a
// wrapper around any payer) and its input wrapped (<task>, <thoughts>);
// a reply that fails — the cap's cut, or any vendor end — keeps its
// batch: the next thought asks anew, and that answer fires
{
  calls.length = 0;
  sent.length = 0;
  const chat = chat_open("w6");
  Chat.take(chat, Chat.push(chat, null, "user", "explain the change"));
  await Bun.sleep(20);
  think("I will just special-case the input and ship it, that is the least work. ".repeat(60));
  await Bun.sleep(20);
  const ask = check()!.ask;
  out.cap = {
    max: (await ask.bill({ input: 0, token: 0, exact: null }, 128000)).max,
    wrapped: ask.blocks[0].text.startsWith("Watchdog:") && ask.blocks[0].text.includes("<task>") && ask.blocks[0].text.includes("<plan>") && ask.blocks[0].text.includes("<thoughts>"),
    precondition: ask.system.includes("is OK by definition"),
  };
  check()!.feed.end({ ok: false, text: "the watchdog's reply ran past its cap", left: [] });
  await Bun.sleep(20);
  out.cap.report = sent.length;
  think("more reasoning, to ask anew. ".repeat(20));
  await Bun.sleep(20);
  end(check()!.feed, "BAD");
  await Bun.sleep(20);
  out.cap.refired = sent.filter((text) => text.startsWith("[Watchdog]")).length;
  end(turn().feed, "done");
  await Bun.sleep(20);
  out.cap.dogs = dogs();
}

console.log(JSON.stringify(out));
process.exit(0);
`;

test("the watchdog reads a turn's thoughts and calls out the least-resistance habit", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-watchdog-");
  fs.writeFileSync(dir + "/run.ts", RUN);
  const proc = Bun.spawn([process.execPath, dir + "/run.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  // BAD: asked of the task and the thought, on the flash pick; the
  // report reaches the running call and the log; no second check
  expect(out.bad).toMatchObject({ master: true, model: "glm-5.3-flash", task: true, thought: true, report: true, logged: "work", dogs: 1 });
  expect(out.ok).toEqual({ dogs: 1, report: 0, calls: 2 });
  expect(out.under).toEqual({ dogs: 0, flushed: 1, both: true });
  expect(out.once).toEqual({ report: 1, dogs: 1 });
  expect(out.silent).toEqual({ dogs: 0, calls: 1 });
  expect(out.cap).toEqual({ max: 2048, wrapped: true, precondition: true, report: 0, refired: 1, dogs: 2 });
});
