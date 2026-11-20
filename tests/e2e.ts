// End-to-end: setup a fresh UNII_DIR, start the local server and device
// against a mock model, send a message, and prove the device ran the
// model's shell call in its own work dir.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const BUN = process.execPath;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uniichat-e2e-"));
const WORK = path.join(TMP, "work");
const MOCK_PORT = 19100;
const PORT = 18788;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...process.env as any, UNII_DIR: TMP, UNII_PORT: String(PORT), UNII_DEVICE: "test-device", ...extra };
}

async function wait(url: string, ms = 20000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(100);
  }
  return false;
}

async function run(cmd: string[], extra: Record<string, string> = {}): Promise<number> {
  const p = Bun.spawn([BUN, ...cmd], { cwd: ROOT, env: env(extra), stdout: "inherit", stderr: "inherit" });
  return await p.exited;
}

let mock: any = null;
let failed = false;
try {
  mock = Bun.spawn([BUN, path.join(ROOT, "tests/mock-model.ts")], {
    cwd: ROOT,
    env: { ...process.env as any, MOCK_PORT: String(MOCK_PORT), TEST_DEVICE: "test-device" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await wait("http://127.0.0.1:" + MOCK_PORT + "/health", 8000))) {
    throw new Error("mock model did not start");
  }

  const setup = await run(["Setup.ts", "--yes", "--server", "http://127.0.0.1:" + MOCK_PORT, "--key", "", "--work", WORK, "--no-start", "--no-autostart"]);
  if (setup !== 0) throw new Error("Setup.ts failed");

  const start = await run(["Control.ts", "start", "--no-open"]);
  if (start !== 0) throw new Error("Control.ts start failed");
  if (!(await wait("http://127.0.0.1:" + PORT + "/"))) throw new Error("server did not come up");

  // the device attaches a moment after the server: wait for its log, then
  // give the socket a beat before the first turn (a person would too)
  const devLog = path.join(TMP, "logs", "device.log");
  const devUntil = Date.now() + 8000;
  while (Date.now() < devUntil) {
    try { if (fs.readFileSync(devLog, "utf8").includes("connected as")) break; } catch {}
    await Bun.sleep(50);
  }
  await Bun.sleep(400);

  const id = crypto.randomUUID();
  const say = await fetch("http://127.0.0.1:" + PORT + "/api/act?id=" + id + "&%24=say&sizes=", {
    method: "POST",
    body: "run the test",
  });
  if (!say.ok) throw new Error("say failed: " + say.status);

  const proof = path.join(WORK, "proof.txt");
  let got = "";
  const until = Date.now() + 20000;
  while (Date.now() < until && got === "") {
    try { got = fs.readFileSync(proof, "utf8").trim(); } catch {}
    if (got === "") await Bun.sleep(150);
  }
  if (got !== "device-ok") throw new Error("device did not run the shell call; proof='" + got + "'");

  const log = path.join(TMP, "users", "1", "main");
  let chat = "";
  const chatUntil = Date.now() + 10000;
  while (Date.now() < chatUntil) {
    const day = fs.existsSync(log) ? fs.readdirSync(log).find((f) => f.endsWith(".jsonl")) : undefined;
    chat = day ? fs.readFileSync(path.join(log, day), "utf8") : "";
    if (chat.includes("done")) break;
    await Bun.sleep(100);
  }
  if (!chat.includes("done")) throw new Error("model's second reply is missing from the chat");

  console.log("PASS: setup -> server -> device -> shell -> model, proof='" + got + "'");
} catch (err: any) {
  failed = true;
  console.error("FAIL: " + (err?.message ?? err));
  try {
    console.error("--- server log ---\n" + fs.readFileSync(path.join(TMP, "logs/server.log"), "utf8").slice(-2000));
    console.error("--- device log ---\n" + fs.readFileSync(path.join(TMP, "logs/device.log"), "utf8").slice(-2000));
  } catch {}
} finally {
  await run(["Control.ts", "stop"]).catch(() => {});
  try { mock?.kill(); } catch {}
  if (!failed) fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
