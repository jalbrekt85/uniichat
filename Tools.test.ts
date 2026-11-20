// Tools test
// ==========
// `bun test Tools.test.ts`. A chat moves twice (A to B to C) while an
// agent's call still runs in A, its MCP requests sent to A's tools. B,
// once its relay is done, ends; A's requests must then reach C, not B:
// C taking the call tells A where the chat is (Main.far, Tools.went).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

process.env.UNII_DIR = fs.mkdtempSync(os.tmpdir() + "/unii-tools-");

const { Tools } = await import("./Tools.ts");

test("a call's MCP requests follow its chat past a process that ended", async () => {
  const tools = Tools.serve({} as any, {} as any);
  const ask = () => fetch(Tools.at(tools, "main"), { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  // B: took the chat, then gave it on and ended
  const b = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("b") });
  const at_b = "http://127.0.0.1:" + b.port + "/";
  Tools.give(tools, at_b, () => "");
  expect(await (await ask()).text()).toBe("b");
  b.stop(true);
  // C: has the chat now; without Tools.went, A would still pass to B:
  // "Unable to connect", as every deploy's second handoff did
  const c = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => new Response("c " + new URL(req.url).pathname) });
  Tools.went(tools.key, "http://127.0.0.1:" + c.port + "/");
  expect(await (await ask()).text()).toBe("c /" + tools.key + "/main");
  c.stop(true);
});

test("a device tool names where it runs: a missing or unknown name resends, a closed device ends the turn", async () => {
  const tools = Tools.serve({} as any, {} as any);
  const name = Tools.attach(tools, "tab", "Mac", "who", { send: () => {}, live: () => true, computer: false, work: "~" });
  const signal = new AbortController().signal;
  // no device field: a malformed call, named as such (was "No device
  // undefined ... end your turn", which ate mid-flight writes)
  const none = await Tools.call(tools, "main", "write", { path: "a", content: "b" }, signal, "j1");
  expect(none).toMatchObject({ fail: true });
  expect(none.text).toContain("no device field");
  expect(none.text).toContain("Mac");
  expect(none.text).not.toContain("end your turn");
  // unknown name: resend with a listed one
  const odd = await Tools.call(tools, "main", "write", { device: "Nope", path: "a", content: "b" }, signal, "j2");
  expect(odd.text).toContain("No device \"Nope\"");
  expect(odd.text).toContain("Resend with device set to one of them");
  expect(odd.text).not.toContain("end your turn");
  // the device's unii closed: the one case end-your-turn is true for
  Tools.detach(tools, "tab", name);
  const shut = Tools.open(tools, name, false);
  expect(typeof shut).toBe("string");
  expect(shut as string).toContain("end your turn");
  // open again: named right, it runs
  expect(Tools.attach(tools, "tab2", name, "who", { send: () => {}, live: () => true, computer: false, work: "~" })).toBe(name);
  expect(typeof Tools.open(tools, name, false)).toBe("object");
});
