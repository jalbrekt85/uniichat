#!/usr/bin/env bun
// Control
// =======
// Starts, stops and reads the local Uniichat server and its device.
// Setup.ts uses it after writing the config; the user runs it through
// `start`, `stop` and `status` wrappers (or `bun Control.ts ...`).
//
// Files, under ~/.unii (UNII_DIR):
//   config.json     the app's settings (Config.ts)
//   local.json      the model server and this machine's key (Local.ts)
//   run/server.pid  the local server's pid
//   run/device.pid  the headless device's pid
//   logs/*.log      both processes' output

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Constants
// =========

export const ROOT  = import.meta.dir;
export const DIR   = process.env.UNII_DIR ?? path.join(os.homedir(), ".unii");
export const RUN   = path.join(DIR, "run");
export const LOGS  = path.join(DIR, "logs");
export const PORT  = Number(process.env.UNII_PORT ?? 8788);
export const SITE  = "http://127.0.0.1:" + PORT;

export type AppConfig = {
  site?      : string;
  vendors?   : string;
  models?    : string;
  pick?      : string;
  compactor? : string;
  watchdog?  : boolean | string;
  user?      : string;
  work?      : string;
};

export type LocalConfig = { server?: string; key?: string };

// Files
// =====

export function readJson<T>(file: string, def: T): T {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data !== null && typeof data === "object" ? data : def;
  } catch {
    return def;
  }
}

export function writeJson(file: string, data: object, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode });
}

export function app_config(): AppConfig {
  return readJson(path.join(DIR, "config.json"), {});
}

export function local_config(): Required<LocalConfig> {
  const file = readJson<LocalConfig>(path.join(DIR, "local.json"), {});
  return {
    server: (process.env.OMLX_BASE_URL ?? file.server ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    key: (process.env.LOCAL_API_KEY ?? file.key ?? "").trim(),
  };
}

export function work_dir(): string {
  const work = app_config().work ?? path.join(DIR, "work");
  return work.startsWith("~/") ? path.join(os.homedir(), work.slice(2)) : work;
}

// Processes
// =========

function pid_file(name: string): string {
  return path.join(RUN, name + ".pid");
}

export function read_pid(name: string): number | null {
  try {
    const n = Number(fs.readFileSync(pid_file(name), "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function alive(pid: number | null): boolean {
  if (pid === null) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

export function kill_tree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

function spawn_script(name: string, script: string, args: string[], env: Record<string, string>, cwd: string): number {
  fs.mkdirSync(RUN, { recursive: true, mode: 0o700 });
  fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(LOGS, name + ".log"), "a");
  const proc = Bun.spawn([process.execPath, path.join(ROOT, script), ...args], {
    cwd,
    env: { ...process.env, ...env, UNII_DIR: DIR },
    stdin: "ignore",
    stdout: log,
    stderr: log,
    detached: process.platform !== "win32",
  });
  proc.unref();
  fs.writeFileSync(pid_file(name), String(proc.pid));
  return proc.pid;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function wait_server(timeout_ms = 15000): Promise<boolean> {
  const until = Date.now() + timeout_ms;
  while (Date.now() < until) {
    if (await reachable(SITE + "/")) {
      return true;
    }
    await Bun.sleep(150);
  }
  return false;
}

export function open_browser(url = SITE): void {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
  } catch {}
}

// Start / stop
// ============

export type StartOptions = { open?: boolean; quiet?: boolean };

export async function start(opts: StartOptions = {}): Promise<void> {
  const app = app_config();
  const local = local_config();
  const work = work_dir();
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(RUN, { recursive: true, mode: 0o700 });
  fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });

  let server = read_pid("server");
  if (!alive(server)) {
    server = spawn_script("server", "Server.ts", [String(PORT)], {
      UNII_DIR: DIR,
      UNII_WORK: work,
      LOCAL_API_KEY: local.key,
      OMLX_BASE_URL: local.server,
    }, ROOT);
    if (!opts.quiet) {
      console.log("server: starting (pid " + server + ")");
    }
  } else if (!opts.quiet) {
    console.log("server: already running (pid " + server + ")");
  }

  if (!(await wait_server())) {
    throw new Error("the local server did not come up; see " + path.join(LOGS, "server.log"));
  }

  let device = read_pid("device");
  if (!alive(device)) {
    device = spawn_script("device", "Device.ts", [], {
      UNII_URL: SITE,
      UNII_WORK: work,
      UNII_DEVICE: process.env.UNII_DEVICE ?? os.hostname(),
      UNII_DEVICE_LOG: path.join(LOGS, "device.log"),
    }, ROOT);
    if (!opts.quiet) {
      console.log("device: starting (pid " + device + ")");
    }
  } else if (!opts.quiet) {
    console.log("device: already running (pid " + device + ")");
  }

  if (!opts.quiet) {
    console.log("chat: " + SITE + " (model " + local.server + ")");
  }
  if (opts.open !== false) {
    const remote = !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(local.server);
    open_browser(remote && !local.key ? SITE + "/setup" : SITE);
  }
}

export function stop(opts: { quiet?: boolean } = {}): void {
  for (const name of ["device", "server"]) {
    const pid = read_pid(name);
    if (alive(pid)) {
      kill_tree(pid!);
      if (!opts.quiet) {
        console.log(name + ": stopped (pid " + pid + ")");
      }
    } else if (!opts.quiet) {
      console.log(name + ": not running");
    }
    try {
      fs.rmSync(pid_file(name));
    } catch {}
  }
}

export async function status(): Promise<void> {
  const local = local_config();
  const app = app_config();
  for (const name of ["server", "device"]) {
    const pid = read_pid(name);
    console.log(name + ": " + (alive(pid) ? "running (pid " + pid + ")" : "stopped"));
  }
  console.log("chat:   " + SITE + " " + ((await reachable(SITE + "/")) ? "(reachable)" : "(not reachable)"));
  console.log("model:  " + local.server + (local.key ? " (key set)" : " (no key)"));
  console.log("work:   " + work_dir());
  console.log("user:   " + (app.user ?? "local"));
  console.log("logs:   " + LOGS);
}

// Autostart
// =========

function mac_plist(): string {
  const uid = process.getuid?.() ?? 501;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.uniichat.local</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(ROOT, "Control.ts")}</string>
    <string>start</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(LOGS, "launchd.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(LOGS, "launchd.log")}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

export function install_autostart(): void {
  fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  if (process.platform === "darwin") {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", "com.uniichat.local.plist");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mac_plist());
    const uid = process.getuid?.() ?? 501;
    Bun.spawnSync(["launchctl", "bootout", "gui/" + uid, file], { stdout: "ignore", stderr: "ignore" });
    const out = Bun.spawnSync(["launchctl", "bootstrap", "gui/" + uid, file], { stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) {
      Bun.spawnSync(["launchctl", "load", "-w", file], { stdout: "ignore", stderr: "ignore" });
    }
    console.log("autostart: installed " + file);
    return;
  }
  if (process.platform === "linux") {
    const dir = path.join(os.homedir(), ".config", "systemd", "user");
    const file = path.join(dir, "uniichat.service");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `[Unit]
Description=Uniichat local
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${path.join(ROOT, "Control.ts")} start --no-open
ExecStop=${process.execPath} ${path.join(ROOT, "Control.ts")} stop

[Install]
WantedBy=default.target
`);
    Bun.spawnSync(["systemctl", "--user", "daemon-reload"], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["systemctl", "--user", "enable", "--now", "uniichat.service"], { stdout: "ignore", stderr: "ignore" });
    console.log("autostart: installed " + file);
    return;
  }
  if (process.platform === "win32") {
    const dir = path.join(process.env.APPDATA ?? os.homedir(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "Uniichat.cmd");
    fs.writeFileSync(file, `@echo off\r\n"${process.execPath}" "${path.join(ROOT, "Control.ts")}" start --no-open\r\n`);
    console.log("autostart: installed " + file);
    return;
  }
}

export function remove_autostart(): void {
  if (process.platform === "darwin") {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", "com.uniichat.local.plist");
    const uid = process.getuid?.() ?? 501;
    Bun.spawnSync(["launchctl", "bootout", "gui/" + uid, file], { stdout: "ignore", stderr: "ignore" });
    try { fs.rmSync(file); } catch {}
  } else if (process.platform === "linux") {
    Bun.spawnSync(["systemctl", "--user", "disable", "--now", "uniichat.service"], { stdout: "ignore", stderr: "ignore" });
  } else if (process.platform === "win32") {
    const file = path.join(process.env.APPDATA ?? os.homedir(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Uniichat.cmd");
    try { fs.rmSync(file); } catch {}
  }
}

// Main
// ====

if (import.meta.main) {
  const cmd = process.argv[2] ?? "status";
  const noOpen = process.argv.includes("--no-open");
  try {
    if (cmd === "start") {
      await start({ open: !noOpen });
    } else if (cmd === "stop") {
      stop();
    } else if (cmd === "restart") {
      stop({ quiet: true });
      await start({ open: !noOpen });
    } else if (cmd === "status") {
      await status();
    } else if (cmd === "autostart") {
      install_autostart();
    } else if (cmd === "no-autostart") {
      remove_autostart();
    } else {
      console.log("usage: Control.ts start|stop|restart|status|autostart|no-autostart [--no-open]");
      process.exit(2);
    }
  } catch (err: any) {
    console.error("uniichat: " + String(err?.message ?? err));
    process.exit(1);
  }
}
