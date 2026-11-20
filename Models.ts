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
import { EFFORTS, SPEEDS } from "./Pick.ts";
import type { Vendor } from "./AskAI.ts";

// Types
// =====

export type Choice = { vendor: Vendor; model: string; effort: string; speed: string };

// models.json: what a model entry may hold (checked below)
type Named = { model?: unknown; effort?: unknown; speed?: unknown };

// Constants
// =========

const FILE = path.join(import.meta.dir, "models.json");

// Models
// ======

function choice(raw: Named | undefined, key: string): Choice {
  const model  = typeof raw?.model === "string" ? raw.model.trim() : "";
  const effort = typeof raw?.effort === "string" ? raw.effort : "";
  const speed  = typeof raw?.speed === "string" ? raw.speed : "";
  if (model === "") {
    throw new Error("models.json: " + key + ".model is empty");
  }
  if (!EFFORTS.includes(effort)) {
    throw new Error("models.json: " + key + ".effort is not one of " + EFFORTS.join(", "));
  }
  if (!SPEEDS.includes(speed)) {
    throw new Error("models.json: " + key + ".speed is not one of " + SPEEDS.join(", "));
  }
  return { vendor: "local-api", model, effort, speed };
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
