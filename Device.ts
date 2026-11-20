#!/usr/bin/env bun
// Device
// ======
// A headless unii: connects to a local Uniichat server as a device and
// runs the jobs its agent sends (shell, read, write, edit) through
// Machine.run. No terminal; it exists so a local server has hands on the
// machine it runs on. On macOS it can use the screen too, by default:
// UNII_COMPUTER=0 turns that off.
//
// A user may have many chats (Sessions.ts on the server): this machine's
// hands must be in all of them, or a fresh chat's tools find no device.
// So it opens one socket per session, learns the others from each
// chat's state (and from /api/session, for one made while it runs), and
// runs each session's jobs on that session's socket. One job id is
// unique across them. A lost socket stops only its own jobs; a shutdown
// stops every shell. Reconnects on its own.
//
// env: UNII_URL (default http://127.0.0.1:8788)
//      UNII_WORK (default ~/.unii/work)
//      UNII_DEVICE (default the host name)

import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { Machine } from "./Machine.ts";
import { FRAME, WIRE } from "./View.ts";

// Types
// =====

// one session's socket, and the jobs it runs
type Conn = { ws: WebSocket; session: string; active: Map<string, AbortController> };

// Constants
// =========

const URL   = (process.env.UNII_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const WORK  = process.env.UNII_WORK ?? path.join(os.homedir(), ".unii", "work");
// this device's name, as the agent sees it: on macOS its local host name
// (Bonjour's, unique on its network), else the host's — as Term.ts names it
const LOCAL = process.platform === "darwin" ? spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const NAME  = process.env.UNII_DEVICE ?? (LOCAL || os.hostname());
const FIRST = "default";
// a local Mac's screen is part of this machine's hands; the user grants
// macOS's Screen Recording and Accessibility once, on the first use
const COMPUTER = process.platform === "darwin" && process.env.UNII_COMPUTER !== "0";
const EVERY = 5000;

// State
// =====

// this machine's sockets, by session; how long to wait before opening a
// lost one again
const conns = new Map<string, Conn>();
let retry = 1000;
let stopped = false;

// Log
// ===

function log(text: string): void {
  process.stdout.write(new Date().toISOString() + " " + text + "\n");
}

// Device
// ======

function send(conn: Conn, msg: object): void {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(msg));
  }
}

// the sessions the server named; a session made meanwhile (a poll) too
function sync(sessions: Array<{ id?: unknown }>): void {
  for (const { id } of sessions) {
    if (typeof id === "string" && id !== "") {
      connect(id);
    }
  }
}

async function list(): Promise<void> {
  try {
    const res = await fetch(URL + "/api/session");
    if (!res.ok) {
      return;
    }
    const out: any = await res.json();
    if (Array.isArray(out?.sessions)) {
      sync(out.sessions);
    }
  } catch {}
}

async function job(conn: Conn, id: string, spec: any): Promise<void> {
  if (conn.active.has(id)) {
    return;
  }
  const ctrl = new AbortController();
  conn.active.set(id, ctrl);
  log("job " + id + " " + spec?.name + " on " + (spec?.cwd ?? "?") + " in " + conn.session);
  let out;
  try {
    out = await Machine.run(spec, spec.work || WORK, ctrl.signal);
  } catch (err: any) {
    out = { text: String(err?.message ?? err), fail: true };
  }
  conn.active.delete(id);
  // the server's socket refuses a message over FRAME: answer its size
  const most = FRAME - 1024;
  if (Buffer.byteLength(JSON.stringify(out)) > most) {
    out = { text: "The output, " + Buffer.byteLength(JSON.stringify(out)) + " bytes, is over the " + most + " a tool may send.", fail: true };
  }
  send(conn, { $: "out", job: id, out });
  log("job " + id + " " + (out.fail ? "failed" : "done") + " in " + conn.session);
}

// the jobs a socket started end with it; the shells of other sessions go
// on
function stop(conn: Conn): void {
  for (const ctrl of conn.active.values()) {
    ctrl.abort();
  }
  conn.active.clear();
}

function connect(session: string): void {
  if (stopped || conns.has(session)) {
    return;
  }
  const url = URL.replace(/^http/, "ws") + "/ws?tab=device&wire=" + WIRE +
    "&device=" + encodeURIComponent(NAME) +
    "&work=" + encodeURIComponent(WORK) +
    "&computer=" + (COMPUTER ? 1 : 0) +
    "&session=" + encodeURIComponent(session);
  const ws = new WebSocket(url);
  const conn: Conn = { ws, session, active: new Map() };
  conns.set(session, conn);
  ws.onopen = () => {
    retry = 1000;
    log("connected as " + NAME + " to " + URL + " session " + session + " (work " + WORK + ")");
  };
  ws.onmessage = (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.$ === "state" && Array.isArray(msg.sessions)) {
      sync(msg.sessions);
      return;
    }
    if (msg.$ === "job" && typeof msg.id === "string") {
      void job(conn, msg.id, msg.job);
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (conns.get(session) === conn) {
      conns.delete(session);
    }
    stop(conn);
    if (stopped) {
      return;
    }
    log("session " + session + " disconnected; retrying in " + Math.round(retry / 1000) + "s");
    setTimeout(() => connect(session), retry);
    retry = Math.min(retry * 2, 30000);
  };
}

function shutdown(code = 0): void {
  stopped = true;
  for (const conn of conns.values()) {
    stop(conn);
    try {
      conn.ws.close();
    } catch {}
  }
  Machine.end();
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => shutdown(0));
}

log("starting: " + NAME + " -> " + URL);
connect(FIRST);
setInterval(() => void list(), EVERY);
