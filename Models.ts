// Models
// ======
// models.json names the two models this fork runs — by the id the model
// server itself uses, exactly as `GET {server}/v1/models` reports it. No
// label, no picker, no config.json: editing models.json is the whole
// change, and whatever string is there is the `model` the request sends.
//
// Where the request goes: Local.ts, to the server in ~/.unii/local.json
// (or OMLX_BASE_URL), at /v1/messages. List that server's ids with its
// key; put one here.
//
// effort: low | medium | high | xhigh | max (above xhigh becomes max for
// GLM). speed: slow | fast | ultrafast.

import * as fs from "node:fs";
import * as path from "node:path";
import { EFFORTS, SPEEDS, VENDORS } from "./Pick.ts";
import type { Vendor } from "./AskAI.ts";

// Types
// =====

export type Choice = { vendor: Vendor; model: string; effort: string; speed: string; window?: number };

// models.json: what a model entry may hold (checked below)
type Named = { vendor?: unknown; model?: unknown; effort?: unknown; speed?: unknown; window?: unknown };

// Constants
// =========

const FILE = path.join(import.meta.dir, "models.json");

// Models
// ======

function choice(raw: Named | undefined, key: string): Choice {
  const vendor = typeof raw?.vendor === "string" ? raw.vendor : "local-api";
  const model  = typeof raw?.model === "string" ? raw.model.trim() : "";
  const effort = typeof raw?.effort === "string" ? raw.effort : "";
  const speed  = typeof raw?.speed === "string" ? raw.speed : "";
  if (model === "") {
    throw new Error("models.json: " + key + ".model is empty");
  }
  if (!VENDORS.includes(vendor as Vendor)) {
    throw new Error("models.json: " + key + ".vendor is not one of " + VENDORS.join(", "));
  }
  if (!EFFORTS.includes(effort)) {
    throw new Error("models.json: " + key + ".effort is not one of " + EFFORTS.join(", "));
  }
  if (!SPEEDS.includes(speed)) {
    throw new Error("models.json: " + key + ".speed is not one of " + SPEEDS.join(", "));
  }
  let window: number | undefined;
  if (raw?.window === undefined) {
    window = undefined;
  } else if (typeof raw.window === "number" && Number.isInteger(raw.window) && raw.window > 0) {
    window = raw.window;
  } else {
    throw new Error("models.json: " + key + ".window must be a positive integer");
  }
  return { vendor: vendor as Vendor, model, effort, speed, ...(window !== undefined ? { window } : {}) };
}

const RAW = JSON.parse(fs.readFileSync(FILE, "utf8"));

// the chat: every turn, and every agent a turn starts
export const MAIN: Choice = choice(RAW?.main, "main");

// the compactor: the one-line summaries of the tree, background only
export const COMPACTOR: Choice = choice(RAW?.compactor, "compactor");

// what a server offers: exactly the wires and ids these two use
export const OFFER = {
  vendors : [...new Set<Vendor>([MAIN.vendor, COMPACTOR.vendor])],
  models  : [...new Set<string>([MAIN.model, COMPACTOR.model])],
};
