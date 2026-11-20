// A tiny Anthropic-Messages stand-in for tests: with tools it asks for
// one shell call (writing proof.txt), then says done; without tools it
// answers a summary, which the compactor needs.
const PORT = Number(process.env.MOCK_PORT ?? 9100);

function sse(events: object[]): Response {
  const text = events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

function start(id: string): object[] {
  return [
    { type: "message_start", message: { id, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
  ];
}

function text(body: string): object[] {
  return [
    ...start("msg_text"),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: body } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ];
}

function tool(): object[] {
  return [
    ...start("msg_tool"),
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "shell", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ device: process.env.TEST_DEVICE ?? "test-device", command: "echo device-ok > proof.txt" }) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } },
    { type: "message_stop" },
  ];
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/health") {
      return new Response("ok");
    }
    if (!p.endsWith("/v1/messages")) {
      return new Response("not found", { status: 404 });
    }
    const body: any = await req.json().catch(() => ({}));
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasResult = JSON.stringify(body.messages ?? []).includes('"tool_result"');
    if (!hasTools) {
      return sse(text("summary of the message"));
    }
    if (hasResult) {
      return sse(text("done"));
    }
    return sse(tool());
  },
});

console.log("mock model on " + PORT);
