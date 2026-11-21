// Debug
// =====
// Structured, append-only events for the local harness. Every model call,
// compactor job, tool job and turn phase records one JSON line in
// ~/.unii/logs/agent.jsonl; the last EVENTS stay in memory for
// /api/status. Nothing here is trusted input: it is written to disk and
// exposed only on the loopback debug endpoint.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DIR = process.env.UNII_DIR ?? path.join(os.homedir(), ".unii");
const FILE = path.join(DIR, "logs", "agent.jsonl");
const EVENTS = 400;

export type Event = {
  at: string;
  kind: string;
  tag: string;
  [key: string]: unknown;
};

const ring: Event[] = [];

let fd: number | null = null;

function file(): number | null {
  if (fd !== null) {
    return fd;
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
    fd = fs.openSync(FILE, "a");
  } catch {
    fd = null;
  }
  return fd;
}

export function record(kind: string, tag: string, data: Record<string, unknown>): void {
  const event: Event = { at: new Date().toISOString(), kind, tag, ...data };
  ring.push(event);
  if (ring.length > EVENTS) {
    ring.splice(0, ring.length - EVENTS);
  }
  const out = file();
  if (out === null) {
    return;
  }
  try {
    fs.writeSync(out, JSON.stringify(event) + "\n");
  } catch {}
}

export function recent(limit = 120, tag?: string): Event[] {
  const all = tag === undefined ? ring : ring.filter((e) => e.tag === tag);
  return all.slice(Math.max(0, all.length - limit));
}

export function last(tag: string): Event | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].tag === tag) {
      return ring[i];
    }
  }
  return null;
}

export function counters(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of ring) {
    out[event.tag] = (out[event.tag] ?? 0) + 1;
  }
  return out;
}

export function tail(limit = 80): Event[] {
  try {
    const lines = fs.readFileSync(FILE, "utf8").trim().split("\n").slice(-limit);
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Event];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function modelContexts(): Record<string, { max_context_window: number | null; max_tokens: number | null }> {
  const out: Record<string, { max_context_window: number | null; max_tokens: number | null }> = {};
  try {
    const file = path.join(os.homedir(), ".omlx", "model_settings.json");
    const models = JSON.parse(fs.readFileSync(file, "utf8")).models ?? {};
    for (const [id, settings] of Object.entries<any>(models)) {
      out[id] = {
        max_context_window: settings.max_context_window ?? null,
        max_tokens: settings.max_tokens ?? null,
      };
    }
  } catch {}
  return out;
}

// the file tail and the model settings change slowly: reading them on
// every status request is work the endpoint does not need to repeat
let diskAt = 0;
let diskTail: Event[] = [];
function disk(): Event[] {
  if (Date.now() - diskAt > 5000) {
    diskTail = tail(80);
    diskAt = Date.now();
  }
  return diskTail;
}

let contextsAt = 0;
let contexts: ReturnType<typeof modelContexts> = {};
function contextsCached(): ReturnType<typeof modelContexts> {
  if (Date.now() - contextsAt > 30000) {
    contexts = modelContexts();
    contextsAt = Date.now();
  }
  return contexts;
}

export function snapshot(limit = 120): object {
  const usage = process.memoryUsage();
  const notices = ring.filter((event) => event.kind === "tool" && event.phase === "externalized");
  return {
    disk: disk(),
    file: FILE,
    modelContexts: contextsCached(),
    contextNotices: {
      count: notices.length,
      last: notices.at(-1) ?? null,
      recent: notices.slice(-12),
    },
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
    },
    ring: ring.length,
    counters: counters(),
    lastMain: last("main"),
    lastCompactor: last("compactor"),
    evictions: {
      count: ring.filter((event) => event.kind === "evict").length,
      recent: recent(12, "evict"),
    },
    labels: {
      count: ring.filter((event) => event.kind === "label").length,
      recent: ring.filter((event) => event.kind === "label").slice(-12),
    },
    compactor: {
      recent: recent(40, "compactor"),
      batches: ring.filter((event) => event.kind === "compactor" && event.phase === "batch").slice(-10),
      tries: ring.filter((event) => event.kind === "compactor" && event.phase === "try").slice(-12),
    },
    events: recent(limit),
  };
}
