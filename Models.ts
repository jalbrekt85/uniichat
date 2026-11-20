// Models
// ======
// The one place this fork's models are chosen: the chat and the compactor.
// There is no config key, no per-chat pick and no picker: every build of
// these sources runs these models, so what the code does is what the repo
// says. To change a model, change it here.
//
// vendor: the wire the call goes through (Pick.ts offers it); model: its
// label there, which Pick.ask turns into the oMLX model id; effort and
// speed: the rest of a Pick.

import type { Vendor } from "./AskAI.ts";

// Types
// =====

export type Choice = { vendor: Vendor; model: string; effort: string; speed: string };

// Constants
// =========

// the chat: every turn, and every agent a turn starts
export const MAIN: Choice = { vendor: "local-api", model: "local-glm", effort: "max", speed: "slow" };

// the compactor: the one-line summaries of the tree, background only
export const COMPACTOR: Choice = { vendor: "local-api", model: "local-glm", effort: "low", speed: "slow" };

// what a server offers: exactly the wires and labels these two use
export const OFFER = {
  vendors : [...new Set<Vendor>([MAIN.vendor, COMPACTOR.vendor])],
  models  : [...new Set<string>([MAIN.model, COMPACTOR.model])],
};
