// Live check: the running app, not a fresh one. It catches a stale or
// crash-looping server, a missing WebSocket state, a rail with no sessions,
// a 429, or any page/console error. Read-only: it never creates or archives
// anything in the real account.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LIVE = "http://127.0.0.1:8788/?skip=1";
const CDP_PORT = 9400 + Math.floor(Math.random() * 80);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uniichat-live-"));

const errors: string[] = [];
const logs: string[] = [];
let chrome: any = null;
let ws: WebSocket | null = null;
let failed = false;

function fail(message: string): never {
  throw new Error(message);
}

async function waitFor(url: string, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {}
    await Bun.sleep(30);
  }
  return false;
}

try {
  // 1. the server process must be newer than the code it serves
  const pg = Bun.spawnSync(["pgrep", "-f", path.join(ROOT, "Server.ts")]);
  const pid = pg.stdout.toString().trim().split("\n")[0];
  if (pid === "") fail("the live server is not running");
  const ps = Bun.spawnSync(["ps", "-p", pid, "-o", "lstart="]);
  const started = Date.parse(ps.stdout.toString().trim());
  if (!Number.isFinite(started)) fail("could not read the server start time");
  const sources = ["Server.ts", "Sessions.ts", "Tools.ts", "Machine.ts", "Device.ts", "View.ts"].map((name) => fs.statSync(path.join(ROOT, name)).mtimeMs);
  const newest = Math.max(...sources);
  if (started + 1000 < newest) {
    fail("the live server (pid " + pid + ", started " + new Date(started).toISOString() + ") is older than the code (" + new Date(newest).toISOString() + "); restart it");
  }

  // 2. a fatal server error since the last start is a failed check
  const logFile = path.join(os.homedir(), ".unii/logs/server.log");
  const tail = Bun.spawnSync(["tail", "-n", "3000", logFile]).stdout.toString();
  const last = tail.lastIndexOf("unii: http");
  if (last < 0) fail("the live server log has no start line");
  const after = tail.slice(last);
  for (const line of after.split("\n")) {
    if (/has already been declared|Uncaught|^error:/i.test(line)) {
      fail("the live server logged a fatal error after its last start: " + line);
    }
  }

  // 3. the real page in the installed Chrome
  if (!fs.existsSync(CHROME)) fail("Google Chrome is not installed");
  chrome = Bun.spawn([CHROME,
    "--headless=new",
    "--remote-debugging-port=" + CDP_PORT,
    "--remote-allow-origins=*",
    "--user-data-dir=" + path.join(TMP, "chrome"),
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "about:blank",
  ], { stdout: "ignore", stderr: "ignore" });
  if (!(await waitFor("http://127.0.0.1:" + CDP_PORT + "/json/version"))) fail("Chrome did not open its DevTools port");

  const list: any = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list")).json();
  const page = list.find((t: any) => t.type === "page");
  if (page === undefined) fail("no Chrome page target");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text ?? "exception");
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      logs.push("console: " + m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      logs.push("log: " + m.params.entry.text);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws!.onopen = () => resolve();
    ws!.onerror = () => reject(new Error("Chrome DevTools socket failed"));
  });
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws!.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try { localStorage.setItem('unii.lite', '1'); localStorage.setItem('unii.intro', '1'); } catch {}",
  });
  const evaluate = async (expression: string): Promise<any> => {
    const r: any = await Promise.race([send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), Bun.sleep(4000).then(() => ({ timeout: true }))]);
    return r?.result?.result?.value;
  };
  await send("Page.navigate", { url: LIVE });
  const until = Date.now() + 10000;
  let chats = 0;
  while (Date.now() < until) {
    chats = Number(await evaluate("document.querySelectorAll('#chats .chat').length")) || 0;
    if (chats > 0) break;
    await Bun.sleep(40);
  }
  if (chats === 0) fail("the live rail has no chats (no WebSocket state)");
  if (logs.some((l) => /429/.test(l))) fail("the live page got a 429: " + logs.filter((l) => /429/.test(l)).join("\n"));
  if (!(await evaluate("document.querySelector('#log > #fx-activity') !== null && document.querySelector('footer #fx-activity') === null"))) fail("the activity chip is not in the chat tail");
  const lite = await evaluate("localStorage.getItem('unii.lite') === '1'");
  if (!lite) {
    const sendA = await evaluate("document.querySelector('#fx-send canvas')?.toDataURL()");
    await Bun.sleep(700);
    const sendB = await evaluate("document.querySelector('#fx-send canvas')?.toDataURL()");
    if (typeof sendA !== "string" || sendA === sendB) fail("the send button is not animating at idle");
  }
  const cursor = await evaluate("getComputedStyle(document.querySelector('.composer .send')).cursor");
  if (cursor !== "pointer" && cursor !== "not-allowed") fail("the send cursor does not reflect state: " + cursor);

  const domIds: string[] = await evaluate("[...document.querySelectorAll('#chats .chat')].map(e => e.dataset.session)");
  const domWorks: string[] = await evaluate("[...document.querySelectorAll('#chats .work-name')].map(e => e.textContent)");
  const api: any = await (await fetch("http://127.0.0.1:8788/api/session")).json();
  const active = (api.sessions ?? []).filter((s: any) => !s.archived).map((s: any) => s.id);
  const missing = active.filter((id: string) => id !== "default" && !domIds.includes(id));
  if (missing.length > 0) fail("the live rail is missing sessions: " + JSON.stringify(missing.slice(0, 5)));
  if (domWorks.length !== (api.works ?? []).length) fail("the live rail has " + domWorks.length + " work headers, server has " + (api.works ?? []).length);
  const version = await evaluate("document.querySelector('script[src*=\"app.js\"]')?.src");
  if (typeof version !== "string" || !version.includes("app.js?v=")) fail("the live page is not running the built app");
  if (errors.length > 0) fail("page errors:\n" + errors.join("\n"));
  if (logs.length > 0) fail("console errors:\n" + logs.join("\n"));

  console.log("PASS: live server pid " + pid + " is current, rail has " + chats + " chats in " + domWorks.length + " works, no console errors");
} catch (err: any) {
  failed = true;
  console.error("FAIL: " + (err?.message ?? err));
  if (errors.length > 0) console.error("page errors:\n" + errors.join("\n"));
  if (logs.length > 0) console.error("console:\n" + logs.join("\n"));
} finally {
  try { ws?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
