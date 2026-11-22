// Config
// ======
// The server's settings. Its DIR ($UNII_DIR, default ~/.unii) holds
// local.json (Local.ts), the lock and users/<id>. There is no
// config.json: every setting is the default below, which a run may
// override with UNII_<KEY>. A path may start with "~/" . The keys are
// read from the environment and removed from it, so no program an agent
// runs inherits them, and put back for the workers.

import * as fs from "node:fs";
import * as os from "node:os";
import { MAIN, COMPACTOR as COMPACTOR_CHOICE, OFFER as OFFER_MODELS, type Choice } from "./Models.ts";
import { Pick, type Offer } from "./Pick.ts";

// Constants
// =========

export const DIR = config_path(process.env.UNII_DIR ?? "~/.unii");

export const SITE    = config_get("site", "http://127.0.0.1:8788").replace(/\/$/, "");
export const OFFER: Offer = OFFER_MODELS;

export const WORK       = config_path(config_get("work", DIR + "/work"));
export const RULES      = config_path(config_get("rules", fs.existsSync(DIR + "/rules.md") ? DIR + "/rules.md" : ""));
export const AFTER      = config_get("after", "");

// this fork's single local user: every visitor is them, no sign-in (the
// server binds 127.0.0.1). "": off, the email sign-in instead
export const USER       = config_get("user", "local");

export const PICK       = config_choice(MAIN, "pick");

// what every compaction runs on, a chat's and an import's alike, whatever
// the chat's pick
export const COMPACTOR  = config_choice(COMPACTOR_CHOICE, "compactor");
export const AGENTS     = config_get("agents", "") ? config_run("agents", config_get("agents", "")) : null;

// what reads the agent's thoughts for the least-resistance habit and
// calls it out (Watchdog.ts). THE TOGGLE, one token in config.json:
// "watchdog": false (or "") turns it off; true or the pick turns it on
const WATCH: any = config_get("watchdog", "false");
const WATCH_OFF = WATCH === false || WATCH === "" || WATCH === "false" || WATCH === "off" || WATCH === "0";
const WATCH_ON_DEFAULT = WATCH === true || WATCH === "true";
export const WATCHDOG   = WATCH_OFF ? null : config_run("watchdog", WATCH_ON_DEFAULT ? "zai-api:glm-5.3-flash:low:slow" : String(WATCH));

// the watchdog's debug (Watchdog.ts): true: each thought it holds, each
// check and its answer, each report, logged to the server's window and
// <dir>/watchdog.log
export const WATCHDOG_DEBUG = config_get("watchdog_debug", "") !== "";
export const WORKERS    = Number(config_get("workers", "0"));

// the iOS app (ios/, Cloud.ts): its App ID, the team's then the bundle's
// ("TEAM.com.example.uniichat"), whose app sign-in links open; and
// the id of the key its pushes are signed with (APNS_KEY holds the key)
export const APPLE      = config_get("apple", "");
export const APNS       = config_get("apns", "");

// the keys, by name, and the variable each is read from
const VARS: Record<string, string> = {
  anthropic       : "ANTHROPIC_API_KEY",
  openai          : "OPENAI_API_KEY",
  zai             : "ZAI_API_KEY",
  deepseek        : "DEEPSEEK_API_KEY",
  local           : "LOCAL_API_KEY",
  resend          : "RESEND_API_KEY",
  apns            : "APNS_KEY",
};
export const KEYS: Record<string, string> = Object.fromEntries(Object.entries(VARS).map(([name, v]) => [name, config_key(v)]));

// Config
// ======

export function config_get(key: string, def: string): string {
  return process.env["UNII_" + key.toUpperCase()] ?? def;
}

function config_path(path: string): string {
  return path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
}

function config_run(key: string, text: string): Pick {
  const [vendor, model, effort, speed] = text.split(":");
  const pick = Pick.read({ vendor, model, effort, speed }, OFFER);
  if (pick === null) {
    throw new Error("config: " + key + " is no vendor:model:effort:speed offered here: " + text);
  }
  return pick;
}

// a model choice fixed in models.json: no table to match, so a model the
// server added works by editing models.json alone (Models.ts checked the
// id is non-empty and the effort and speed are known)
function config_choice(choice: Choice, key: string): Pick {
  if (!OFFER.vendors.includes(choice.vendor)) {
    throw new Error("config: " + key + " names vendor " + choice.vendor + ", which is not offered");
  }
  return { ...choice };
}

function config_key(name: string): string {
  const key = (process.env[name] ?? "").trim();
  delete process.env[name];
  return key;
}

// the environment a worker of this server starts with: this one, with
// the keys back
export function config_env(): Record<string, string | undefined> {
  const keys = Object.entries(VARS).map(([name, v]) => [v, KEYS[name]]);
  return { ...process.env, ...Object.fromEntries(keys) };
}
