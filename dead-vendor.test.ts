// Dead-vendor end-to-end test
// ===========================
// `bun test dead-vendor.test.ts`. The real Server.ts serves a scratch
// dir on a scratch port; the vendor is faked dead (z.ai's documented
// no-balance 429/1113). A backlog of unbuilt summaries is left on disk
// and the chat is closed (the state before the user's hang); a client
// then takes the browser's route — a WebSocket view plus a POSTed
// message — and must SEE the vendor's words as a note, the turn end,
// one request per summary and never more, the same on a second message,
// and a real reply once the vendor answers. Timers run 1000x fast.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const CHILD = `
const CONFIG = ${JSON.stringify(import.meta.dir + "/Config.ts")};
const CLOUD = ${JSON.stringify(import.meta.dir + "/Cloud.ts")};
const MEMORY = ${JSON.stringify(import.meta.dir + "/Memory.ts")};
const SERVER = ${JSON.stringify(import.meta.dir + "/Server.ts")};

import * as fs from "node:fs";
import * as os from "node:os";
const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-dead-");
process.env.UNII_DIR = DIR;

const config = await import(CONFIG);
config.KEYS.zai = "test";
config.KEYS.anthropic = "test";

const NOBAL = "[1113][Insufficient balance or no resource package. Please recharge.]";
const real = { setTimeout, clearTimeout, fetch, error: console.error };
let terminal = true;
let asked = 0;
(globalThis as any).setTimeout = (fn: any, ms = 0, ...r: any[]) => real.setTimeout(fn, ms / 1000, ...r);
(globalThis as any).clearTimeout = (t: any) => real.clearTimeout(t);
function answer(text: string, stop: string): Response {
  const events = [
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 100 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\\n\\n").join(""));
}
(globalThis as any).fetch = (async (url: any, init: any) => {
  const body = JSON.parse(init.body);
  if (body.method !== undefined) {
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  }
  asked += 1;
  if (terminal) {
    return Response.json({ type: "error", error: { type: "rate_limit_error", code: "1113", message: NOBAL } }, { status: 429 });
  }
  if (body.metadata !== undefined || body.messages === undefined) {
    return Response.json({ type: "error", error: { type: "api_error", message: "upstream provider error" } }, { status: 503 });
  }
  const task: string = body.messages[0].content.at(-1).text;
  return answer("line for " + task.split("\\n")[0], "end_turn");
}) as any;

const { Cloud } = await import(CLOUD);
const { Memory } = await import(MEMORY);
const Server = await import(SERVER);
const { Chat } = Server;

const port = 8900 + (process.pid % 80);
await (Server as any).serve(port, null);
const user = Cloud.who(Chat.cloud, new Request("http://127.0.0.1/"))!;

// phase 1: a backlog that failed terminal, left on disk, the chat closed —
// the state the user's hang started from
{
  const chat = Chat.open(user)!;
  chat.socks.add({ send: () => {}, close: () => {}, data: { seen: new Set() } } as any);
  await Bun.sleep(50);
  for (let k = 0; k < 16; k++) {
    Chat.push(chat, null, "user", "filler ".repeat(200) + k);
  }
  await Bun.sleep(400);
  if (!String(chat.mem.failed).includes("1113")) {
    real.error.call(console, "SEED FAILED: failed=" + String(chat.mem.failed).slice(0, 80) + " asked=" + asked);
    process.exit(1);
  }
  await Chat.end(chat);
}
const seeded = asked;

// phase 2: the browser's route over the reloaded chat
const got: any[] = [];
const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws?tab=e2e&wire=2");
ws.onmessage = (ev) => {
  try {
    got.push(JSON.parse(String(ev.data)));
  } catch {}
};
await new Promise((ok, bad) => {
  const t = real.setTimeout(() => bad(new Error("no socket open")), 5000);
  ws.onopen = () => {
    real.clearTimeout(t);
    ok(null);
  };
  ws.onerror = () => bad(new Error("socket error"));
});
// opening the chat resumes the failed side once (Chat.open's pump): let
// it finish failing, then measure each user action separately
await Bun.sleep(300);
const atOpen = asked;

async function say(text: string): Promise<void> {
  const res = await real.fetch("http://127.0.0.1:" + port + "/api/act?$=say&sizes=&id=" + crypto.randomUUID(), { method: "POST", body: text });
  if (!res.ok) {
    throw new Error("say HTTP " + res.status + ": " + (await res.text()));
  }
}
const notes = () => got.filter((m) => m.$ === "entry" && m.kind === "note" && m.text.includes("1113")).length;
const busy = () => {
  for (let k = got.length - 1; k >= 0; k--) {
    if (got[k].$ === "state") return got[k].busy;
  }
  return null;
};
async function wait(ok: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms / 25; t++) {
    if (ok()) return true;
    await Bun.sleep(25);
  }
  return ok();
}

await say("hello");
const msg1 = await wait(() => notes() >= 1 && busy() === false, 8000);
const at1 = asked;

await say("again");
const msg2 = await wait(() => notes() >= 2 && busy() === false, 8000);
const at2 = asked;

terminal = false;
await say("go");
const msg3 = await wait(() => got.some((m) => m.$ === "entry" && m.kind === "unii") && busy() === false, 8000);

ws.close();
console.log("E2E " + JSON.stringify({
  seeded,
  msg1: { ok: msg1, asked: at1 - atOpen },
  msg2: { ok: msg2, asked: at2 - at1 },
  msg3: { ok: msg3, replied: got.some((m) => m.$ === "entry" && m.kind === "unii"), asked: asked - at2 },
  note1: got.find((m) => m.$ === "entry" && m.kind === "note")?.text ?? "",
}));
process.exit(0);
`;

test("a message over a dead vendor's backlog reaches the browser as the vendor's error, never hangs, and recovers", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-e2e-");
  fs.writeFileSync(dir + "/child.ts", CHILD);
  const proc = Bun.spawn([process.execPath, dir + "/child.ts"], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const line = out.trim().split("\n").find((l) => l.startsWith("E2E "));
  if (line === undefined) {
    throw new Error("child exited " + code + " with no E2E line; stderr tail:\n" + err.trim().split("\n").slice(-12).join("\n"));
  }
  const o = JSON.parse(line.slice(4));
  if (!o.msg1.ok || !o.msg2.ok || !o.msg3.ok) {
    throw new Error("E2E incomplete: " + line.slice(4));
  }
  // communicated: the vendor's words reached the view, the turn ended
  expect(o.msg1.ok).toBe(true);
  expect(o.note1).toContain("1113");
  expect(o.note1).toContain("Insufficient balance");
  // one request per summary, no retries, no hang
  expect(o.msg1.asked).toBe(16);
  expect(o.msg2.ok).toBe(true);
  expect(o.msg2.asked).toBe(16);
  // the vendor answered: the tree builds (leaves and merges) and the chat replies
  expect(o.msg3.ok).toBe(true);
  expect(o.msg3.replied).toBe(true);
  expect(o.msg3.asked).toBeGreaterThan(15); // the leaves and the merges build, then the turn asks
}, 60000);
