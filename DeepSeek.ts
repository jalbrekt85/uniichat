// DeepSeek
// =======
// The wire of deepseek-api (Agent.ts): DeepSeek's Anthropic-compatible
// endpoint (https://api.deepseek.com/anthropic/v1/messages), keyed
// DEEPSEEK_API_KEY. It is Anthropic.ts's wire at DeepSeek's URL:
// x-api-key or a bearer both authenticate, anthropic-version is
// ignored, thinking is controlled by the thinking field (adaptive
// treated as enabled, budget_tokens ignored) and reasoning effort by
// output_config.effort (low/medium map to high, xhigh/max to max).
// cache_control is ignored (prompt caching is not supported:
// cache_creation_input_tokens is always 0, cache_read_input_tokens
// exists). There is no count_tokens endpoint documented, so a body's
// input tokens are never told exactly (Agent.worst books its byte
// estimate, by design). Server-side web_search runs on DeepSeek's side
// (server_tool_use blocks, usage counted). temperature must stay unset
// in thinking mode (fixed 1.0), which the body already does.

import { Anthropic } from "./Anthropic.ts";
import type { Ask } from "./AskAI.ts";
import type { Wire } from "./Agent.ts";

// Types
// =====

// a stream read so far, as Anthropic's
type State = ReturnType<(typeof Anthropic.wire)["start"]>;

// Constants
// =========

const MESSAGES = "https://api.deepseek.com/anthropic/v1/messages";

// DeepSeek
// ========

export namespace DeepSeek {

  // DeepSeek documents no count_tokens endpoint: never told exactly
  export async function count(_key: string, _ask: Ask, _body: unknown): Promise<null> {
    return null;
  }

  export const wire: Wire<State> = {
    ...Anthropic.wire,
    key   : "deepseek",
    url   : MESSAGES,
    count : DeepSeek.count,
  };

}
