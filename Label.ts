// A tool call's line for the memory: what the call did, in a sentence,
// never the JSON the model wrote. Memory.source uses a message's `line`
// when it has one, so a call labeled here is stored without a summary
// call at all (its line fits NODE), and the view shows the actor and its
// target instead of escaped arguments.

const MAX = 512;

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

// at most MAX bytes, cut on a character boundary, marked with an ellipsis
export function clip(text: string, max = MAX): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) {
    return text;
  }
  const room = Math.max(0, max - Buffer.byteLength("…"));
  const head = buf.subarray(0, room).toString("utf8").replace(/\uFFFD+$/, "");
  return head.replace(/[\s,;:.]+$/, "") + "…";
}

// the name and the input of a call's text ("shell {json}"); input is null
// when the text is not a name followed by JSON (a vendor's raw arguments)
function parse(text: string): { name: string; input: unknown; rest: string } {
  const at = text.search(/\s/);
  const name = at < 0 ? text : text.slice(0, at);
  const rest = at < 0 ? "" : text.slice(at + 1).trim();
  try {
    return { name, input: JSON.parse(rest), rest };
  } catch {
    return { name, input: null, rest };
  }
}

// a call's line: "shell: <the command>", "write: <path>", "edit: <paths>",
// "computer: <task>"; other tools keep their name and arguments
export function call(text: string): string {
  const { name, input, rest } = parse(text);
  const known = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const tool = name.toLowerCase();
  let line: string;
  if (tool === "shell" || tool === "bash") {
    line = "shell: " + flat(str(known?.command) || rest);
  } else if (tool === "write") {
    const path = str(known?.path) || str(known?.file);
    line = "write: " + flat(path || rest);
  } else if (tool === "edit") {
    const edits = known?.edits;
    const paths = Array.isArray(edits)
      ? edits.map((edit) => str((edit as Record<string, unknown> | null)?.path)).filter(Boolean)
      : [str(known?.path)].filter(Boolean);
    line = "edit: " + flat(paths.join(", ") || rest);
  } else if (tool === "computer") {
    line = "computer: " + flat(str(known?.task) || rest);
  } else if (tool === "read") {
    const path = str(known?.path) || str(known?.file);
    const offset = Number(known?.offset);
    const limit = Number(known?.limit);
    let range = "";
    if (Number.isFinite(limit) && limit > 0) {
      const from = Number.isFinite(offset) ? offset : 0;
      range = " " + from + "–" + (from + limit);
    } else if (Number.isFinite(offset)) {
      range = " at " + offset;
    }
    line = "read: " + flat(path || rest) + range;
  } else {
    // any other tool: its most telling string argument, never the blob
    const keys = ["path", "file", "command", "query", "url", "task", "name", "pattern", "prompt", "message"];
    const key = keys.find((k) => str(known?.[k]).trim() !== "");
    line = name + ": " + flat(key !== undefined ? str(known![key]) : rest);
  }
  return clip(line);
}

export const Label = { call, clip, flat };
