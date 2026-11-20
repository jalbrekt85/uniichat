#!/usr/bin/env bun
// Setup
// =====
// One run from a fresh clone: writes config.json and local.json, starts
// the local server and its device, opens the local setup page (the key
// goes there, not in the terminal), and installs autostart.
//
// Flags (tests/scripts):
//   bun Setup.ts --server URL --key KEY --work DIR --no-open --no-autostart

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DIR, PORT, start, install_autostart } from "./Control.ts";
import { DEFAULT_SERVER, LAN_IP_SERVER, LAN_SERVER } from "./Remote.ts";

// Args
// ====

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
}
const NO_OPEN    = args.includes("--no-open");
const NO_START   = args.includes("--no-start");
const NO_AUTO    = args.includes("--no-autostart");

// Defaults
// ========

const DEFAULT_WORK = path.join(os.homedir(), "Uniichat");

// Setup
// =====

// the model host is compiled in: users are never asked for a URL. A LAN
// user gets the direct LAN endpoint; only when it is unreachable does the
// public Funnel path apply. --server / UNIICHAT_SERVER override both.
async function lan_server(): Promise<string | null> {
  for (const base of [LAN_SERVER, LAN_IP_SERVER]) {
    try {
      const res = await fetch(base + "/health", { signal: AbortSignal.timeout(1500) });
      // 200, or 503 while a model loads: both mean this is the Mac. For
      // the bare-IP fallback, require an oMLX-shaped body so a different
      // network's 192.168.4.22 cannot capture a remote user.
      // the Bonjour name is unambiguous: 200 or 503 means the Mac
      if (base === LAN_SERVER && (res.ok || res.status === 503)) {
        return base;
      }
      // the bare IP is not: require an oMLX-shaped body
      const body: any = await res.json().catch(() => null);
      if (body && (body.default_model || body.status)) {
        return base;
      }
    } catch {}
  }
  return null;
}
const picked = arg("server") ?? process.env.UNIICHAT_SERVER;
const lan = picked === undefined ? await lan_server() : null;
// if this machine is plainly on the Mac's LAN subnet, never silently use
// the public Funnel: that is the hairpin this is meant to avoid
function on_lan_subnet(): boolean {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) {
      const family = String(n.family);
      if (!n.internal && (family === "IPv4" || family === "4") && n.address.startsWith("192.168.4.")) {
        return true;
      }
    }
  }
  return false;
}
if (picked === undefined && lan === null && on_lan_subnet()) {
  console.error("Setup: this machine is on the Mac's LAN (192.168.4.x) but the LAN model endpoint is unreachable.");
  console.error("Not falling back to the public Funnel, which would hairpin through the internet. Check the Mac's firewall and port 8000, or pass --server.");
  process.exit(2);
}
const via = picked !== undefined ? "explicit" : lan !== null ? (lan === LAN_SERVER ? "lan" : "lan-ip") : "remote";
const server = (picked ?? lan ?? DEFAULT_SERVER).replace(/\/$/, "");
const key    = (arg("key") ?? process.env.LOCAL_API_KEY ?? "").trim();
const work   = path.resolve(arg("work") ?? DEFAULT_WORK);

if (server === "" || !/^https?:\/\//.test(server)) {
  console.error("Setup: the model server must be an http(s) URL.");
  process.exit(2);
}
if (server.includes("YOUR-HOST")) {
  console.error("Setup: this fork's model host is not set yet. The fork owner sets DEFAULT_SERVER in Remote.ts once the tunnel exists.");
  process.exit(2);
}

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(work, { recursive: true });

const app = {
  site       : "http://127.0.0.1:" + PORT,
  vendors    : "local-api",
  models     : "local-glm,local-qwen,local-mid,local-smoke",
  pick       : "local-api:local-glm:max:slow",
  compactor  : "local-api:local-mid:low:slow",
  watchdog   : false,
  user       : "local",
  work,
};
const local = { server, key };

fs.writeFileSync(path.join(DIR, "config.json"), JSON.stringify(app, null, 2) + "\n", { mode: 0o600 });
fs.writeFileSync(path.join(DIR, "local.json"), JSON.stringify(local, null, 2) + "\n", { mode: 0o600 });

console.log("config: " + path.join(DIR, "config.json"));
console.log("model:  " + server + (key ? " (key set)" : " (no key)") + " [" + via + "]");
console.log("work:   " + work);

if (!NO_START) {
  await start({ open: !NO_OPEN });
}

if (!NO_AUTO) {
  install_autostart();
}

console.log("");
console.log("Uniichat is ready: " + (NO_START ? "start it with `bun Control.ts start`" : "http://127.0.0.1:8788"));
if (!key && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(server)) {
  console.log("Finish in the browser page that opened: paste your API key there.");
}
