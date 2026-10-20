// Zai
// ===
// The wire of zai-api (Agent.ts): z.ai's GLM models (a GLM Coding Plan
// or an API key) behind their Anthropic-compatible Messages API,
// streamed. It is claude-api's wire (Anthropic.ts) whole, at z.ai's
// URL, keyed ZAI_API_KEY: the gateway takes the key either way (x-api-key
// or a bearer), counts tokens, and runs the web_search server tool
// itself. GLM thinks of its own accord (an effort changes nothing: the
// field it ignores), answering thinking blocks, kept and signed; what
// else it lacks (adaptive thinking, a speed, a cache_control the top of
// a request marks) it ignores, so the body goes unchanged.

import { Anthropic } from "./Anthropic.ts";
import type { Ask } from "./AskAI.ts";
import type { Wire } from "./Agent.ts";

// Types
// =====

// a stream read so far, as Anthropic's
type State = ReturnType<(typeof Anthropic.wire)["start"]>;

// Constants
// =========

const MESSAGES = "https://api.z.ai/api/anthropic/v1/messages";
const COUNT    = MESSAGES + "/count_tokens";

// Zai
// ===

export namespace Zai {

  // a body's input tokens, as the API counts them (free): as
  // Anthropic.count, at z.ai's URL
  export async function count(key: string, ask: Ask, body: any): Promise<number | null> {
    const { max_tokens, stream, ...rest } = body;
    const init = { method: "POST", headers: Anthropic.headers(key, ask), body: JSON.stringify(rest), signal: AbortSignal.timeout(10e3) };
    const out = await fetch(COUNT, init).then((res) => res.json()).catch(() => null);
    return typeof out?.input_tokens === "number" ? out.input_tokens : null;
  }

  export const wire: Wire<State> = {
    ...Anthropic.wire,
    key     : "zai",
    url     : MESSAGES,
    count   : Zai.count,
  };

}
