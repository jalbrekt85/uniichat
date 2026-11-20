// The gate: one while the model writes, two while it waits on a tool, all
// JOBS when the main turn is fully stopped.
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, type Item } from "../Agent.ts";
import { JOBS, Memory } from "../Memory.ts";

const made: Array<{ mem: Memory; dir: string }> = [];

function load(): Memory {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unii-gate-"));
  const mem = Memory.load(dir, () => ({} as any));
  made.push({ mem, dir });
  return mem;
}

function fake(mem: Memory, n: number): { stops: number } {
  const state = { stops: 0 };
  for (let i = 0; i < n; i++) {
    const call = { stop: () => { state.stops++; } };
    mem.calls.set(call as any, { l: 0, i, kind: "compactor" });
  }
  return state;
}

afterEach(() => {
  for (const { mem, dir } of made.splice(0)) {
    Memory.stop(mem);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a main turn gates new work without cutting running summaries", () => {
  const mem = load();
  const calls = fake(mem, 3);

  Memory.gate(mem, true);
  expect(mem.agent).toBe(true);
  expect(Memory.agenting()).toBe(true);
  // the gate limits new starts; it never stops in-flight summaries
  expect(calls.stops).toBe(0);

  // a second start is idempotent: no double count
  Memory.gate(mem, true);
  expect(calls.stops).toBe(0);

  Memory.gate(mem, false);
  expect(mem.agent).toBe(false);
  expect(Memory.agenting()).toBe(false);
});

test("room is four fully stopped, one writing, two waiting on a tool", () => {
  const mem = load();

  // fully stopped: the whole pool
  for (let i = 0; i < JOBS - 1; i++) {
    mem.busy.set(i, 0);
  }
  expect(Memory.room(mem, 0)).toBe(true);
  mem.busy.set(JOBS - 1, 0);
  expect(Memory.room(mem, 0)).toBe(false);
  mem.busy.clear();

  // main turn active and the model writing: one
  Memory.gate(mem, true);
  Memory.generating(true);
  expect(Memory.room(mem, 0)).toBe(true);
  mem.busy.set(0, 0);
  expect(Memory.room(mem, 0)).toBe(false);
  mem.busy.clear();

  // main turn active and waiting on a tool: two
  Memory.gate(mem, true)
  Memory.generating(false);
  expect(Memory.room(mem, 0)).toBe(true);
  mem.busy.set(0, 0);
  expect(Memory.room(mem, 0)).toBe(true);
  mem.busy.set(1, 0);
  expect(Memory.room(mem, 0)).toBe(false);
  mem.busy.clear();

  // fully stopped again: the whole pool
  Memory.gate(mem, false);
  for (let i = 0; i < JOBS - 1; i++) {
    mem.busy.set(i, 0);
  }
  expect(Memory.room(mem, 0)).toBe(true);
  mem.busy.set(JOBS - 1, 0);
  expect(Memory.room(mem, 0)).toBe(false);
  mem.busy.clear();
});

test("the gate is global across chats", () => {
  const a = load();
  const b = load();
  const ca = fake(a, 2);
  const cb = fake(b, 2);

  Memory.gate(a, true);
  Memory.gate(b, true);
  expect(Memory.agenting()).toBe(true);
  expect(ca.stops + cb.stops).toBe(0);

  Memory.gate(a, false);
  expect(Memory.agenting()).toBe(true);
  Memory.gate(b, false);
  expect(Memory.agenting()).toBe(false);
});

test("drain waits for the pool without stopping a summary", async () => {
  const mem = load();
  const calls = fake(mem, 3);
  for (let i = 0; i < 3; i++) {
    mem.busy.set(i, 0);
  }

  let done = false;
  const signal = new AbortController().signal;
  const waiting = Memory.drain(mem, 1, signal).then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(calls.stops).toBe(0);

  mem.busy.delete(0);
  mem.busy.delete(1);
  for (const check of [...mem.wait]) {
    check();
  }
  await waiting;
  expect(done).toBe(true);
  expect(calls.stops).toBe(0);
});

test("a too-long 400 is terminal, as other 400s are", () => {
  const body = JSON.stringify({ error: { message: "Prompt is too long: 65604 tokens > 65536 maximum context length" } });
  const res = new Response(body, { status: 400 });
  expect(Agent.terminal(res, body)).toBe(true);

  const other = new Response(JSON.stringify({ error: { message: "invalid model" } }), { status: 400 });
  expect(Agent.terminal(other, "invalid model")).toBe(true);
});
