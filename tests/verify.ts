// The streamlined gate: build (stale/syntax errors), the isolated server/
// device end-to-end, the isolated browser flows, the real running app, and
// the unit suite. Any failure stops the gate.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const BUN = process.execPath;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uniichat-verify-"));
let failed = false;

async function step(name: string, run: () => Promise<void>): Promise<void> {
  process.stdout.write("\n== " + name + " ==\n");
  const start = Date.now();
  await run();
  console.log("ok: " + name + " (" + ((Date.now() - start) / 1000).toFixed(1) + "s)");
}

async function child(script: string): Promise<void> {
  const p = Bun.spawn([BUN, path.join(ROOT, "tests", script)], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  if (code !== 0) throw new Error(script + " failed with exit " + code);
}

try {
  await step("build", async () => {
    const server = await Bun.build({
      entrypoints: [path.join(ROOT, "Server.ts"), path.join(ROOT, "Device.ts")],
      target: "bun",
      outdir: path.join(TMP, "build"),
      minify: false,
    });
    if (!server.success) {
      throw new Error("the server does not build:\n" + server.logs.map(String).join("\n"));
    }
    const web = await Bun.build({
      entrypoints: [path.join(ROOT, "web/src/main.ts")],
      target: "browser",
      outdir: path.join(TMP, "web"),
      minify: false,
    });
    if (!web.success) {
      throw new Error("the web app does not build:\n" + web.logs.map(String).join("\n"));
    }
  });

  // the suites use separate temp dirs, ports and browser profiles, so they
  // can run at once. Wall time becomes the slowest suite, not the sum.
  const results = await Promise.allSettled([
    step("isolated server/device", () => child("e2e.ts")),
    step("isolated browser flows", () => child("ui.ts")),
    step("live app", () => child("live.ts")),
    step("unit", async () => {
      const p = Bun.spawn([BUN, "test"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
      const code = await p.exited;
      if (code !== 0) throw new Error("unit tests failed with exit " + code);
    }),
  ]);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected !== undefined) throw rejected.reason;

  console.log("\nVERIFY PASS: build, e2e, ui, live app, and unit all green");
} catch (err: any) {
  failed = true;
  console.error("\nVERIFY FAIL: " + (err?.message ?? err));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
