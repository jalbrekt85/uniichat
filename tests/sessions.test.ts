// Sessions test
// =============
// `bun test tests/sessions.test.ts`. Two chats of one user are two
// Memories: each has its own messages and tree, its own id in
// Chat.chats, and each is listed with its own title; the first chat is
// the user's original directory, in place.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-sessions-");
process.env.UNII_DIR = DIR;

const config = await import("../Config.ts");
config.KEYS.anthropic = "test";
config.KEYS.zai      = "test";

const { Cloud } = await import("../Cloud.ts");
const { Memory } = await import("../Memory.ts");
const { Sessions } = await import("../Sessions.ts");
const { Chat, Main } = await import("../Server.ts");

Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);

const USER = { id: "1", name: "local" };

function hold(chat: ReturnType<typeof Chat.open>): void {
  chat!.socks.add({ send: () => {}, close: () => {}, data: { seen: new Set() } } as any);
}

test("two chats of one user are two trees, one directory each", async () => {
  const a = Chat.open(USER, Sessions.DEFAULT)!;
  hold(a);
  const b = Chat.open(USER, "s-12345678")!;
  hold(b);

  expect(a).not.toBe(b);
  expect(a.session).toBe(Sessions.DEFAULT);
  expect(b.session).toBe("s-12345678");
  expect(Chat.chats.get(Chat.key(USER.id, Sessions.DEFAULT))).toBe(a);
  expect(Chat.chats.get(Chat.key(USER.id, "s-12345678"))).toBe(b);
  expect(a.mem.dir).toBe(DIR + "/users/1");
  expect(b.mem.dir).toBe(DIR + "/users/1/sessions/s-12345678");

  Chat.push(a, null, "user", "the first chat's message");
  Chat.push(b, null, "user", "a new chat's message");
  expect(a.mem.count).toBe(1);
  expect(b.mem.count).toBe(1);
  expect(Memory.message(a.mem, 0)!.text).toContain("first chat");
  expect(Memory.message(b.mem, 0)!.text).toContain("new chat");

  // each chat's state lists both, each with its own title
  const state = Chat.state(a);
  expect(state.session).toBe(Sessions.DEFAULT);
  expect(state.sessions.map((s) => s.id).sort()).toEqual(["default", "s-12345678"]);
  expect(state.sessions.find((s) => s.id === Sessions.DEFAULT)!.title).toBe("the first chat's message");
  expect(state.sessions.find((s) => s.id === "s-12345678")!.title).toBe("a new chat's message");

  // the default chat is the original directory, untouched; the new one
  // is under sessions/
  expect(fs.existsSync(DIR + "/users/1/main.index")).toBe(true);
  expect(fs.existsSync(DIR + "/users/1/sessions/s-12345678/main.index")).toBe(true);

  await Chat.end(a);
  await Chat.end(b);
  expect(Chat.chats.size).toBe(0);

  // an older chat has no session.json: reopening it adopts its first
  // user message as its title, without touching its memory
  fs.rmSync(DIR + "/users/1/session.json", { force: true });
  Sessions.forget(USER.id);
  const again = Chat.open(USER, Sessions.DEFAULT)!;
  hold(again);
  expect(Sessions.title(USER.id, Sessions.DEFAULT)).toBe("the first chat's message");
  expect(again.mem.count).toBe(1);
  await Chat.end(again);
});

test("the server makes a chat and lists it", async () => {
  const made = await Main.session(USER, new Request("http://127.0.0.1/api/session", { method: "POST", body: "{}" }));
  const out: any = await made.json();
  expect(typeof out.id).toBe("string");
  expect(Sessions.valid(out.id)).toBe(true);
  expect(out.sessions.some((chat: any) => chat.id === out.id)).toBe(true);

  const listed = await Main.session(USER, new Request("http://127.0.0.1/api/session"));
  const list: any = await listed.json();
  expect(list.sessions.some((chat: any) => chat.id === out.id)).toBe(true);

  const bad = await Main.session(USER, new Request("http://127.0.0.1/api/session", { method: "POST", body: JSON.stringify({ id: "../escape" }) }));
  expect(bad.status).toBe(400);
});

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

test("a session id is a name, never a path", () => {
  expect(Sessions.valid(Sessions.DEFAULT)).toBe(true);
  expect(Sessions.valid("s-12345678")).toBe(true);
  expect(Sessions.valid("../escape")).toBe(false);
  expect(Sessions.valid("a/b")).toBe(false);
  expect(Sessions.valid("")).toBe(false);
  expect(Sessions.pick("../escape")).toBe(Sessions.DEFAULT);
  expect(Sessions.pick(null)).toBe(Sessions.DEFAULT);
});
