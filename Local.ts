// Local
// =====
// The wire of local-api (Agent.ts): an oMLX server's Anthropic-compatible
// Messages API, streamed. It is claude-api's wire whole (Anthropic.ts),
// at the server named in ~/.unii/local.json (or OMLX_BASE_URL), keyed
// LOCAL_API_KEY (or the key in that file). oMLX has no count_tokens:
// count is null; the prompt count comes only from the usage the model
// reports, with no byte estimate. The credit gate, inert locally, never
// waits on it. The body goes unchanged: oMLX ignores what it does not
// implement (adaptive thinking, a speed, cache_control at the top), and
// GLM's chat template reads reasoning_effort / clear_thinking through the
// server's template kwargs.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Anthropic } from "./Anthropic.ts";
import type { Ask } from "./AskAI.ts";
import type { Wire } from "./Agent.ts";

// Types
// =====

// a stream read so far, as Anthropic's
type State = ReturnType<(typeof Anthropic.wire)["start"]>;

// what setup writes: the model server and this machine's key
type LocalFile = { server?: string; key?: string };

// Constants
// =========

const DIR = process.env.UNII_DIR ?? os.homedir() + "/.unii";
const FILE = path.join(DIR, "local.json");

// Local
// =====

export namespace Local {

  // the file setup wrote, or {} if it is absent or broken
  export function file(): LocalFile {
    try {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      return data !== null && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  // the model server: OMLX_BASE_URL, then the file, then local oMLX
  export function server(): string {
    return (process.env.OMLX_BASE_URL || Local.file().server || "http://127.0.0.1:8000").replace(/\/$/, "");
  }

  // this machine's key: LOCAL_API_KEY, then the file; "" means no auth
  export function key(): string {
    return (process.env.LOCAL_API_KEY || Local.file().key || "").trim();
  }

  export function save(server: string, key: string): void {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify({ server: server.replace(/\/$/, ""), key }, null, 2) + "\n", { mode: 0o600 });
  }

  // the model's configured context window, from oMLX's settings; null:
  // unknown (not an oMLX model, or no such setting)
  export function window(id: string): number | null {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".omlx", "model_settings.json"), "utf8"));
      const n = Number(settings?.models?.[id]?.max_context_window);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  export const wire: Wire<State> = {
    key     : "local",
    idle    : 300e3,
    // read at call time: a settings change applies to the next call
    get url(): string {
      return Local.server() + "/v1/messages";
    },
    // accept either header: oMLX takes an x-api-key or a bearer
    headers : (key, ask) => ({
      ...Anthropic.headers(key, ask),
      authorization: "Bearer " + key,
    }),
    body    : (ask, items, tools, max) => {
      const body: any = Anthropic.body(ask, items, tools, max);
      // GLM's chat template takes its effort and thinking policy from
      // template kwargs; the Anthropic body does not carry them.
      const model = String(ask.model).toLowerCase();
      if (model.includes("glm")) {
        body.chat_template_kwargs = {
          ...(body.chat_template_kwargs ?? {}),
          // xhigh is Uniichat's label above high; GLM's template has max.
          // Everything else passes through, so the UI's "medium" is medium.
          reasoning_effort: ask.effort === "xhigh" ? "max" : ask.effort,
          clear_thinking: true,
        };
      } else if (model.includes("qwen")) {
        // qwen's template otherwise spends its whole output budget in a
        // thinking block; the compactor needs a visible summary line.
        body.chat_template_kwargs = {
          ...(body.chat_template_kwargs ?? {}),
          enable_thinking: false,
        };
      }
      return body;
    },
    // oMLX has no count_tokens: the model's reported usage is the count
    count   : async () => null,
    start   : (ask) => Anthropic.wire.start(ask),
    read    : (st, ev, on) => Anthropic.read(st, ev, on),
    begun   : (ev) => ev.type === "message_start",
    step    : (st, ask) => Anthropic.wire.step(st, ask),
    usage   : (st) => st.use,
  };

}
