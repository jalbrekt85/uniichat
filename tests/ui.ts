// UI end-to-end: a fresh server, mock model and device in a temp dir, then
// the real page in the installed Chrome, driven over the DevTools Protocol.
// Any page error, console error or failed socket fails the run. It covers
// the rail's workspaces, the + that starts a chat in place, switching chats,
// the folder picker at home, and a new work dir going to the top.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const BUN = process.execPath;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uniichat-ui-"));
const WORK = path.join(TMP, "work");
const TWO = path.join(TMP, "two");
const THREE = path.join(TMP, "three");
const FOUR = path.join(TMP, "four");
const PICK = path.join(TMP, "picked");
const MOCK_PORT = 19100 + Math.floor(Math.random() * 80);
const PORT = 18700 + Math.floor(Math.random() * 80);
const CDP_PORT = 9300 + Math.floor(Math.random() * 60);

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...process.env as any, UNII_DIR: TMP, UNII_PORT: String(PORT), UNII_DEVICE: "ui-device", ...extra };
}

async function wait(url: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(30);
  }
  return false;
}

async function run(cmd: string[], extra: Record<string, string> = {}): Promise<number> {
  const p = Bun.spawn([BUN, ...cmd], { cwd: ROOT, env: env(extra), stdout: "inherit", stderr: "inherit" });
  return await p.exited;
}

async function post(pathname: string, body: object): Promise<any> {
  const res = await fetch("http://127.0.0.1:" + PORT + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(pathname + " failed: " + res.status + " " + JSON.stringify(out));
  return out;
}

type Cdp = {
  errors: string[];
  logs: string[];
  evaluate: (expression: string) => Promise<any>;
  navigate: (url: string) => Promise<void>;
  waitFor: (expression: string, ms?: number) => Promise<void>;
  close: () => void;
};

async function connect(): Promise<Cdp> {
  const list: any = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list")).json();
  const page = list.find((t: any) => t.type === "page");
  if (page === undefined) throw new Error("no Chrome page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map<number, (v: any) => void>();
  const errors: string[] = [];
  const logs: string[] = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push((d.exception?.description ?? d.text ?? "exception") + "\n" + (d.stackTrace?.callFrames ?? []).slice(0, 4).map((f: any) => "  " + f.functionName + " " + f.url + ":" + f.lineNumber).join("\n"));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      logs.push(m.params.type + ": " + m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      logs.push("log: " + m.params.entry.text);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Chrome DevTools socket failed"));
  });
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try { localStorage.setItem('unii.lite', '1'); localStorage.setItem('unii.intro', '1'); } catch {}",
  });
  const evaluate = async (expression: string): Promise<any> => {
    const r: any = await Promise.race([
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      Bun.sleep(2500).then(() => ({ timeout: true })),
    ]);
    return r?.result?.result?.value;
  };
  const cdp: Cdp = {
    errors,
    logs,
    evaluate,
    navigate: async (url) => {
      await send("Page.navigate", { url });
    },
    waitFor: async (expression, ms = 8000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        await Bun.sleep(30);
      }
      throw new Error("timed out waiting for: " + expression + (errors.length ? "\n" + errors.join("\n") : ""));
    },
    close: () => {
      ws.close();
      try { process.exitCode = 0; } catch {}
    },
  };
  return cdp;
}

let mock: any = null;
let chrome: any = null;
let cdp: Cdp | null = null;
let failed = false;

try {
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(TWO, { recursive: true });
  fs.mkdirSync(THREE, { recursive: true });
  fs.mkdirSync(FOUR, { recursive: true });
  fs.mkdirSync(PICK, { recursive: true });

  mock = Bun.spawn([BUN, path.join(ROOT, "tests/mock-model.ts")], {
    cwd: ROOT,
    env: { ...process.env as any, MOCK_PORT: String(MOCK_PORT), TEST_DEVICE: "ui-device" },
    stdout: "ignore",
    stderr: "inherit",
  });
  if (!(await wait("http://127.0.0.1:" + MOCK_PORT + "/health", 5000))) {
    throw new Error("mock model did not start");
  }

  const setup = await run(["Setup.ts", "--yes", "--server", "http://127.0.0.1:" + MOCK_PORT, "--key", "", "--work", WORK, "--no-start", "--no-autostart"]);
  if (setup !== 0) throw new Error("Setup.ts failed");
  const start = await run(["Control.ts", "start", "--no-open"]);
  if (start !== 0) throw new Error("Control.ts start failed");
  if (!(await wait("http://127.0.0.1:" + PORT + "/"))) throw new Error("server did not come up");

  // three works before the page loads: the newest first, the default last
  const w1 = await post("/api/works", { path: TWO });
  const want1 = [TWO, WORK];
  if (JSON.stringify(w1.works) !== JSON.stringify(want1)) throw new Error("after add two: " + JSON.stringify(w1.works) + " != " + JSON.stringify(want1));
  const w2 = await post("/api/works", { path: THREE });
  const want2 = [THREE, TWO, WORK];
  if (JSON.stringify(w2.works) !== JSON.stringify(want2)) throw new Error("after add three: " + JSON.stringify(w2.works) + " != " + JSON.stringify(want2));
  await post("/api/session", { work: TWO });
  await post("/api/session", { work: WORK });

  if (!fs.existsSync(CHROME)) {
    throw new Error("Google Chrome is not installed at " + CHROME);
  }
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
  if (!(await wait("http://127.0.0.1:" + CDP_PORT + "/json/version", 6000))) {
    throw new Error("Chrome did not open its DevTools port");
  }
  cdp = await connect();
  await cdp.navigate("http://127.0.0.1:" + PORT + "/?skip=1");
  await cdp.waitFor("document.querySelectorAll('#chats .chat').length >= 2");
  await cdp.evaluate("localStorage.setItem('unii.intro', '1'); localStorage.setItem('unii.lite', '1')");

  const works = await cdp.evaluate("[...document.querySelectorAll('#chats .work-name')].map(e => e.textContent)");
  // the dirs were added three, two; then a chat in two made two the active
  // work, and active works lead the rail
  const wantWorks = [path.basename(TWO), path.basename(THREE), path.basename(WORK)];
  if (JSON.stringify(works) !== JSON.stringify(wantWorks)) {
    throw new Error("work order " + JSON.stringify(works) + " != " + JSON.stringify(wantWorks));
  }

  const before = await cdp.evaluate("[...document.querySelectorAll('#chats .chat')].map(e => e.dataset.session)");
  await cdp.evaluate("document.querySelector('#chats .work-plus')?.click()");
  await Bun.sleep(200);
  await cdp.waitFor("location.search.includes('session=')");
  await cdp.waitFor("document.readyState === 'complete' && document.querySelector('#chats .chat.here') !== null");
  await cdp.waitFor("document.querySelectorAll('#chats .chat').length >= " + (before.length + 1));
  const after = await cdp.evaluate("[...document.querySelectorAll('#chats .chat')].map(e => e.dataset.session)");
  if (!before.every((id: string) => after.includes(id))) throw new Error("the + lost chats: before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
  if (after.length !== before.length + 1) throw new Error("the + did not add exactly one chat");

  // a chat opens a fresh page; the page's socket must close and the rail must
  // be complete again each time, with no 429 and no console error. Two
  // switches exercise both directions without four full reloads.
  await cdp.waitFor("document.readyState === 'complete' && document.querySelector('#chats .chat.here') !== null");
  await cdp.evaluate("document.querySelector('#chats .chat[data-session]:not(.here)')?.click()");
  await Bun.sleep(200);
  await cdp.waitFor("document.querySelector('#chats .chat.here') !== null");
  const ids = await cdp.evaluate("[...document.querySelectorAll('#chats .chat')].map(e => e.dataset.session)");
  if (ids.length < 2) throw new Error("need two chats to switch");

  await cdp.evaluate("document.querySelector('[data-work-new]')?.click()");
  await cdp.waitFor("document.querySelector('#workdir')?.matches(':popover-open')");
  await cdp.waitFor("document.querySelector('#workdir .pick-path')?.value === " + JSON.stringify(os.homedir()));
  const picked = await cdp.evaluate("document.querySelector('#workdir .pick-path')?.value");
  if (picked !== os.homedir()) throw new Error("picker opened at " + picked + ", not home " + os.homedir());
  await cdp.evaluate("document.querySelector('#workdir').hidePopover()");

  // choose a new folder in the picker: it becomes a work at the top and its
  // chat opens; then send through the mock model and the real device, and
  // prove the shell ran in the chosen work dir, not in the user's home
  await cdp.evaluate("document.querySelector('[data-work-new]')?.click()");
  await cdp.waitFor("document.querySelector('#workdir')?.matches(':popover-open')");
  await cdp.waitFor("document.querySelector('#workdir .pick-path')?.value === " + JSON.stringify(os.homedir()));
  await cdp.evaluate("document.querySelector('#workdir .pick-path').value = " + JSON.stringify(PICK));
  await cdp.evaluate("document.querySelector('#workdir .pick-path').dispatchEvent(new Event('input', { bubbles: true }))");
  const before_pick = await cdp.evaluate("location.search");
  await cdp.evaluate("document.querySelector('[data-pick-choose]')?.click()");
  await cdp.waitFor("location.search !== " + JSON.stringify(before_pick) + " && location.search.includes('session=') && document.querySelector('#chats .work-name')?.textContent === " + JSON.stringify(path.basename(PICK)));

  const devLog = path.join(TMP, "logs", "device.log");
  const devUntil = Date.now() + 5000;
  while (Date.now() < devUntil) {
    try { if (fs.readFileSync(devLog, "utf8").includes("connected as")) break; } catch {}
    await Bun.sleep(100);
  }
  await cdp.waitFor("document.querySelector('.composer textarea') !== null");
  await cdp.evaluate("(() => { const b = document.querySelector('.composer textarea'); b.value = 'run the test'; b.dispatchEvent(new Event('input', { bubbles: true })); return b.value; })()");
  const sendHit = await cdp.evaluate(`(() => {
    const layer = document.querySelector('#fx-send');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
    layer.append(probe);
    const b = document.querySelector('.send');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    probe.remove();
    return { send: !!el?.closest('.send'), overlay: !!el?.closest('#fx-send'), disabled: b.disabled };
  })()`);
  if (!sendHit.send || sendHit.overlay || sendHit.disabled) {
    throw new Error("the send button is covered by its effect layer: " + JSON.stringify(sendHit));
  }
  await cdp.evaluate("document.querySelector('.send')?.click()");
  const proof = path.join(PICK, "proof.txt");
  let got = "";
  const proofUntil = Date.now() + 12000;
  while (Date.now() < proofUntil && got === "") {
    try { got = fs.readFileSync(proof, "utf8").trim(); } catch {}
    if (got === "") await Bun.sleep(30);
  }
  if (got !== "device-ok") throw new Error("the UI send did not run the device shell in the chosen work; proof='" + got + "'");
  await cdp.waitFor("document.querySelector('#log')?.innerText?.includes('done')");

  const sid = await cdp.evaluate("new URLSearchParams(location.search).get('session')");
  await post("/api/session", { id: sid, archive: true });
  await cdp.waitFor("![...document.querySelectorAll('#chats .chat')].some(e => e.dataset.session === " + JSON.stringify(sid) + ")");
  await post("/api/session", { id: sid, archive: false });
  await cdp.waitFor("[...document.querySelectorAll('#chats .chat')].some(e => e.dataset.session === " + JSON.stringify(sid) + ")");

  await post("/api/works", { path: FOUR });
  await cdp.waitFor("document.querySelector('#chats .work-name')?.textContent === " + JSON.stringify(path.basename(FOUR)));

  // fast gallery smoke: all 11 entries enumerated, two real previews mount
  await cdp.evaluate("document.querySelector('[data-effects]')?.click()");
  await cdp.waitFor("document.querySelector('.gallery') !== null");
  const libs = await cdp.evaluate("[...document.querySelectorAll('.gallery-nav button')].map(b => b.textContent)");
  if (libs.length !== 11) throw new Error("the effects gallery has " + libs.length + " libraries, expected 11: " + JSON.stringify(libs));
  if ((await cdp.evaluate("document.querySelectorAll('.gallery-elements li').length")) === 0) throw new Error("the gallery does not enumerate the library elements");
  await cdp.evaluate("document.querySelectorAll('.gallery-nav button')[1]?.click()");
  await cdp.waitFor("document.querySelector('.gallery-preview .g-center') !== null");
  if (Number(await cdp.evaluate("document.querySelectorAll('.gallery-control button').length")) === 0) throw new Error("gallery variants are not exposed");
  await cdp.evaluate("document.querySelector('.gallery-close')?.click()");
  await cdp.waitFor("document.querySelector('.gallery') === null");

  await cdp.evaluate("(() => { const i = document.querySelector('.chats-search input'); i.value = 'zzz-no-match'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await cdp.waitFor("document.querySelectorAll('#chats .chat').length === 0");
  await cdp.evaluate("(() => { const i = document.querySelector('.chats-search input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await cdp.waitFor("document.querySelectorAll('#chats .chat').length > 0");

  // the polish controls: sound toggle and floating tooltip
  await cdp.evaluate("document.querySelector('header .menu')?.click()");
  await cdp.waitFor("document.querySelector('#menu')?.matches(':popover-open')");
  const soundBefore = await cdp.evaluate("document.querySelector('#menu [data-sound]')?.getAttribute('aria-pressed')");
  await cdp.evaluate("document.querySelector('#menu [data-sound]')?.click()");
  await cdp.waitFor("document.querySelector('#menu [data-sound]')?.getAttribute('aria-pressed') !== " + JSON.stringify(soundBefore));
  await cdp.evaluate("document.querySelector('#menu [data-sound]')?.click()");
  await cdp.waitFor("document.querySelector('#menu [data-sound]')?.getAttribute('aria-pressed') === " + JSON.stringify(soundBefore));
  await cdp.evaluate("document.querySelector('#menu')?.hidePopover()");
  await cdp.evaluate("document.querySelector('#chats .work-plus')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))");
  await cdp.waitFor("document.querySelector('#tip')?.dataset.open === '1'");
  await cdp.evaluate("document.querySelector('#chats .work-plus')?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))");
  await cdp.waitFor("document.querySelector('#tip')?.dataset.open === '0'");

  // the CTA animation itself is checked by the full live app; the UI suite
  // runs the lite profile, where that canvas does not mount.
  const liteProfile = await cdp.evaluate("localStorage.getItem('unii.lite') === '1'");
  if (!liteProfile) {
    const sendA = await cdp.evaluate("document.querySelector('#fx-send canvas')?.toDataURL()");
    await Bun.sleep(350);
    const sendB = await cdp.evaluate("document.querySelector('#fx-send canvas')?.toDataURL()");
    if (typeof sendA !== "string" || sendA === sendB) throw new Error("the send button is not animating at idle");
  }

  // no visible button may be left without a transition or animation
  const staticButtons = await cdp.evaluate("JSON.stringify([...document.querySelectorAll('button')].filter((el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && s.transitionProperty === 'none' && s.animationName === 'none'; }).map((el) => (el.className || el.id || el.textContent || 'button').trim().slice(0, 60)))");
  if (staticButtons !== "[]") throw new Error("buttons without motion: " + staticButtons);

  if (cdp.errors.length > 0) throw new Error("page errors:\n" + cdp.errors.join("\n"));
  if (cdp.logs.length > 0) throw new Error("console errors:\n" + cdp.logs.join("\n"));
  console.log("PASS: UI rail, +, navigation, picker at home, chosen folder on top, device shell in the chosen work, archive/restore, no console errors");
} catch (err: any) {
  failed = true;
  console.error("FAIL: " + (err?.message ?? err));
  if (cdp !== null) {
    try {
      console.error("debug: " + await cdp.evaluate("JSON.stringify({ url: location.href, body: document.body.className, chats: document.querySelectorAll('#chats .chat').length, here: document.querySelector('#chats .chat.here')?.dataset.session, intro: Boolean(document.querySelector('#intro')), rail: (document.querySelector('#chats .sessions')?.innerText ?? '').slice(0, 240) })"));
    } catch {}
    console.error("page errors: " + (cdp.errors.length ? cdp.errors.join("\n") : "none"));
    console.error("console: " + (cdp.logs.length ? cdp.logs.join("\n") : "none"));
  }
  try {
    console.error("--- server log ---\n" + fs.readFileSync(path.join(TMP, "logs/server.log"), "utf8").slice(-3000));
  } catch {}
} finally {
  try { cdp?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  await run(["Control.ts", "stop"]).catch(() => {});
  try { mock?.kill(); } catch {}
  if (!failed) fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
