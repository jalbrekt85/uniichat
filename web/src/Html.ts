// Html
// ====
// What View.ts draws and Md.ts's tokens, as HTML, every text escaped, one
// element per row, knob or tab; and the account page's parts. A click's
// effect is in the markup: `data-act`, the View.Act it makes;
// `data-copy`, what Copy copies; `data-usd`, the credit it buys
// (main.ts), so `credit_html` works wherever it is put.

import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import * as View from "../../View.ts";

// Constants
// =========

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// a user's message past TALL chars (a line counts 80 or more: a paste)
// shows its head; its `details` unfolds it (style.css)
const TALL = 4000;

// the Copy button's icons: two sheets, and a check once copied
export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

// a diff line's class, by its mark
const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

// Show
// ====

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function copy_html(text: string): string {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}

// a row's markup, made once: a known message's rows are kept (View's
// whole_rows)
const MADE = new WeakMap<View.Row, string>();

export function row_html(row: View.Row, session = ""): string {
  const html = MADE.get(row) ?? row_make(row, session);
  MADE.set(row, html);
  return html;
}

function row_make(row: View.Row, session: string): string {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, Call.call_line(row.call), "");
      const tool = row.call === null ? "" : ` data-tool="${esc(row.call.name)}"`;
      return `<div class="block"${open} data-a="${row.id}"${tool}><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": { // a message open (1x) looks as it does whole, its "fold" pill beside Copy
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one  = row.n === 1 ? " one" : "";
      const rows = row.rows.map((r) => row_html(r, session)).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const copy = copy_html(row.call === null ? row.text : Call.call_text(row.call));
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images, session);
      const echo = row.kind === "echo";
      const out = echo ? output_kind(row.text) : "";
      const state = echo ? (out === "error" ? "error" : out === "empty" ? "empty" : "ok") : "";
      const result = echo
        ? ` data-output="${out}" data-result-of="${esc(row.tool)}" data-state="${state}" data-label="${esc((row.tool === "" ? "output" : row.tool) + " · " + out)}"`
        : "";
      const tall = (["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL)
        || (echo && (row.text.split("\n").length > 24 || row.text.length > 1800));
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      const tool = row.call === null ? "" : ` data-tool="${esc(row.call.name)}"`;
      return `<div class="msg ${row.kind}"${at}${who}${tool}${result}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}

// a tool call: its icon, verb, head and device, over a code block for
// each other value
function call_html(c: Call.Call): string {
  return head_html(c, c.head, c.device) + tool_input_html(c) + c.blocks.map(block_html).join("");
}

// Each tool's arguments get their own compact input panel. Write shows the
// content it will create; edit shows its old/new pairs; the others expose
// the meaningful metadata the head abbreviates.
function tool_input_html(c: Call.Call): string {
  const x = c.input;
  const fields: string[] = [];
  const field = (label: string, value: string): void => {
    if (value.trim() !== "") {
      fields.push(`<span class="tool-field"><span>${esc(label)}</span><b>${esc(value)}</b></span>`);
    }
  };
  switch (c.name) {
    case "read":
      field("path", String(x.path ?? ""));
      if (x.offset !== undefined || x.limit !== undefined) field("lines", String(x.offset ?? 1) + "–" + String(x.limit === undefined ? "end" : Number(x.offset ?? 1) + Number(x.limit) - 1));
      break;
    case "write":
      field("file", String(x.path ?? ""));
      if (typeof x.content === "string") field("lines", String(x.content.split("\n").length));
      break;
    case "edit":
      field("files", c.head);
      if (Array.isArray(x.edits)) field("edits", String(x.edits.length));
      break;
    case "spawn":
      if (Array.isArray(x.tasks)) field("tasks", String(x.tasks.length));
      if (typeof x.effort === "string") field("effort", x.effort);
      break;
    case "tell":
      field("to", String(x.name ?? ""));
      break;
    case "computer":
      if (typeof x.task === "string") field("task", x.task.length > 60 ? x.task.slice(0, 60) + "…" : x.task);
      break;
    case "web_search":
      field("query", String(x.query ?? ""));
      break;
    case "fetch_url":
      field("url", String(x.url ?? ""));
      break;
    case "zoom":
    case "date":
      field("target", c.head);
      break;
  }
  const meta = fields.length === 0 ? "" : `<div class="tool-fields">${fields.join("")}</div>`;
  if (c.name === "write" && typeof x.content === "string" && x.content !== "") {
    return meta + `<pre class="tool-input-content"><code>${esc(x.content)}</code></pre>`;
  }
  if (c.name === "edit" && Array.isArray(x.edits)) {
    const edits = (x.edits as Array<{ path?: string; old?: string; new?: string }>).map((edit, i) => {
      const path = typeof edit.path === "string" && edit.path !== "" ? edit.path : c.head !== "" ? c.head : "edit " + (i + 1);
      const old = typeof edit.old === "string" ? edit.old : "";
      const now = typeof edit.new === "string" ? edit.new : "";
      return `<div class="tool-edit"><span class="tool-edit-label">${esc(path)}</span>${old === "" ? "" : `<pre class="tool-edit-old"><code>${esc(old)}</code></pre>`}${now === "" ? "" : `<pre class="tool-edit-new"><code>${esc(now)}</code></pre>`}</div>`;
    }).join("");
    return meta + `<div class="tool-edits">${edits}</div>`;
  }
  return meta;
}

// line icons rather than emoji: each kind of call gets a silhouette that
// matches its job, and the card's accent reads the same in both themes
const TOOL_ICON: Record<string, string> = {
  shell: `<svg viewBox="0 0 16 16"><path d="M2.5 4.5l3 3-3 3M7.5 11h6"/></svg>`,
  read: `<svg viewBox="0 0 16 16"><path d="M3 2.5h6l3 3v8H3z"/><path d="M9 2.5v3h3M5.2 8h5.6M5.2 10h4.2"/></svg>`,
  write: `<svg viewBox="0 0 16 16"><path d="M3 2.5h6l3 3v8H3z"/><path d="M9 2.5v3h3M8 7.5v4M6 9.5h4"/></svg>`,
  edit: `<svg viewBox="0 0 16 16"><path d="M3 13l1-3 7-7 2 2-7 7z"/><path d="M9.4 4.6l2 2M2.5 13.5h4"/></svg>`,
  spawn: `<svg viewBox="0 0 16 16"><circle cx="4.5" cy="8" r="2"/><circle cx="12" cy="4" r="1.6"/><circle cx="12" cy="12" r="1.6"/><path d="M6.4 7.1l4-2M6.4 8.9l4 2"/></svg>`,
  tell: `<svg viewBox="0 0 16 16"><path d="M3 3.5h10v6H7l-3 2v-2H3z"/><path d="M5.5 6h5M5.5 8h3"/></svg>`,
  computer: `<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="7.5" rx="1"/><path d="M6 13.5h4M8 10.5v3"/></svg>`,
  web_search: `<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>`,
  fetch_url: `<svg viewBox="0 0 16 16"><path d="M6.2 9.8l3.6-3.6M5.4 11.4l-1 1a2.2 2.2 0 003.1 3.1l1-1M10.6 4.6l1-1a2.2 2.2 0 00-3.1-3.1l-1 1"/></svg>`,
  zoom: `<svg viewBox="0 0 16 16"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>`,
  date: `<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/></svg>`,
};
const TOOL_FALLBACK = `<svg viewBox="0 0 16 16"><path d="M10.8 2.6a3.2 3.2 0 00-4.1 4.1L2.5 11a1.5 1.5 0 002.1 2.1l4.3-4.2a3.2 3.2 0 004.1-4.1l-1.7 1.7-1.8-1.8z"/></svg>`;

function tool_icon(name: string): string {
  return TOOL_ICON[name] ?? TOOL_FALLBACK;
}

// a call's head: its line icon, name, then text ("" device: none shown)
function head_html(c: Call.Call, text: string, device: string): string {
  const icon  = `<span class="ic">${tool_icon(c.name)}</span>`;
  const verb  = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call" data-tool="${esc(c.name)}">${where}${icon}${verb}${esc(text)}</p>`;
}

function images_html(names: string[], session: string): string {
  const q = session === "" ? "" : "?session=" + encodeURIComponent(session);
  const pics = names.map((name) => {
    const url = "/image/" + esc(name) + q;
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}

// the line over the message box: fold/unfold (none on an agent's page),
// a rule, then the pick's knobs
export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[]): string[] {
  const parts = knobs.map((k) => `<button title="${esc(k.hint)}"${act_html({ $: "Move", move: k.move })}>${esc(k.text)}</button>`);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => (i === 0 ? [part] : [`<span class="dot">·</span>`, part]))];
}

// the chats in the switcher: each its title (or a number until its first
// message) and its size; the one this page is of, marked. Archived chats
// are not here at all: they wait behind the rail's Archived button.
const ARCHIVE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v2.5H2zM3 6.5h10v6H3zM6 9h4"/></svg>`;
const RESTORE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 1 1.5 3.6M3 12V8.7h3.3"/></svg>`;

function chat_row(chat: View.Session, k: number, current: string, archived: boolean): string {
  const title = chat.title.trim() === "" ? (chat.messages === 0 ? "New chat" : "Chat " + (k + 1)) : chat.title;
  const count = chat.messages + (chat.messages === 1 ? " message" : " messages");
  const here  = archived ? "" : chat.id === current ? " here" : "";
  const aria  = here === "" ? "" : ' aria-current="page"';
  const off   = archived ? " archived" : "";
  const label = archived ? "Restore chat" : "Archive chat";
  const meta  = `<span class="meta"><span>${esc(count)}</span></span>`;
  return `<button class="chat${here}${off}" data-session="${esc(chat.id)}" title="${esc(title + " · " + chat.work)}"${aria}><b>${esc(title)}</b>${meta}<span class="archive" data-archive="${esc(chat.id)}" data-on="${archived ? "0" : "1"}" role="button" tabindex="0" title="${label}" aria-label="${label}">${archived ? RESTORE : ARCHIVE}</span></button>`;
}

// a work dir's short name, the last part of its path
function work_name(work: string): string {
  const parts = work.split("/").filter((part) => part !== "");
  return parts.length === 0 ? "/" : parts[parts.length - 1];
}

// the chats grouped under their work dir, in the rail's work order; a
// work with no chat still gets its header, so a folder can be added first
function groups(sessions: View.Session[], works: string[], archived: boolean): Array<[string, View.Session[]]> {
  const order: string[] = [];
  const map = new Map<string, View.Session[]>();
  const add = (work: string) => {
    if (!map.has(work)) {
      map.set(work, []);
      order.push(work);
    }
  };
  for (const work of works) {
    add(work);
  }
  for (const chat of sessions) {
    if (chat.archived === archived) {
      add(chat.work);
    }
  }
  for (const chat of sessions) {
    if (chat.archived === archived) {
      map.get(chat.work)!.push(chat);
    }
  }
  return order.map((work) => [work, map.get(work)!] as [string, View.Session[]]);
}

function work_head(work: string, archived: boolean): string {
  const plus = archived ? "" : `<button class="work-plus" data-newchat="${esc(work)}" title="New chat in ${esc(work)}" aria-label="New chat in ${esc(work)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`;
  return `<div class="work-head" title="${esc(work)}"><span class="work-name">${esc(work_name(work))}</span>${plus}</div>`;
}

// the rail: every work dir, its chats under it, and a + to start one there
export function sessions_html(sessions: View.Session[], current: string, works: string[], empty = "No chats yet."): string[] {
  const currentWork = sessions.find((chat) => chat.id === current)?.work ?? "";
  const out: string[] = [];
  for (const [work, chats] of groups(sessions, works, false)) {
    const rows = chats.map((chat, k) => chat_row(chat, k, current, false)).join("");
    out.push(`<div class="work${work === currentWork ? " here" : ""}">${work_head(work, false)}${rows}</div>`);
  }
  return out.length === 0 ? [`<p class="empty">${empty}</p>`] : out;
}

// what the Archived popup lists: every hidden chat, grouped by its work
export function archived_html(sessions: View.Session[], works: string[]): string[] {
  const out: string[] = [];
  for (const [work, chats] of groups(sessions, works, true)) {
    if (chats.length === 0) {
      continue;
    }
    const rows = chats.map((chat, k) => chat_row(chat, k, "", true)).join("");
    out.push(`<div class="work">${work_head(work, true)}${rows}</div>`);
  }
  return out.length === 0 ? [`<p class="empty">No archived chats.</p>`] : out;
}

// the folder picker's rows: a dir to open, its path in the title
export function dirs_html(dirs: Array<{ name: string; path: string }>): string[] {
  if (dirs.length === 0) {
    return [`<p class="empty">No folders here.</p>`];
  }
  return dirs.map((dir) => `<button class="dir" data-pick-dir="${esc(dir.path)}" title="${esc(dir.path)}"><span>${esc(dir.name)}</span><span class="chev">›</span></button>`);
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}

// Account
// =======

// buying credit: a button per amount, then the fine print (in the iOS
// app, the App Store's)
export function credit_html(app: boolean): string {
  const buttons = [10, 25, 50, 100].map((usd) => `<button data-usd="${usd}">$${usd}</button>`).join("");
  return `<div class="credit"><div class="usd">${buttons}</div>${fine_html(app)}</div>`;
}

// what buying credit costs and means, in one line (the terms say the rest)
export function fine_html(app: boolean): string {
  const fee = app ? "Paid at the App Store's price." : "+10% platform fee (min $0.80).";
  return `<p class="fine">${fee} Buying accepts the <a href="/terms.html" target="_blank">terms</a>.</p>`;
}

// the account page (/account): where the server bills, the balance and
// credit to add, the use by day and the purchases; then the account's
// own acts; deleting asks first, in place (main.ts)
export function account_html(a: View.Account, app: boolean, session = ""): string {
  const tops    = a.topups ?? [];
  const days    = View.account_days(a);
  const balance = a.credits === null ? "" : section_html("Balance", `<p class="big">${View.usd_show(a.credits)}</p>` + credit_html(app));
  const usage   = section_html("Usage", days.length === 0 ? `<p class="sub">Nothing yet.</p>` : table_html("days", ["Day", "Use", "Cost"], days.map((d) => [d.date, d.what, View.cost_show(d.usd)])));
  const buys    = tops.length === 0 ? "" : section_html("Purchases", table_html("buys", View.TOPUP, tops.map(View.topup_cells)));
  const money   = a.bills ? balance + usage + buys : "";
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const closes  = a.bills ? `<p>This also closes your BendAI account (same sign-in). Credit you bought and didn't use goes back to your card.</p>` : "";
  const kill    = `<form class="kill" hidden>${closes}<p>Type <b>${esc(a.name)}</b> to confirm.</p><input name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(a.name)}"><p class="why"></p><div><button type="button" class="chip keep">Cancel</button><button class="chip red" disabled>Delete for good</button></div></form>`;
  const acts    = [
    item(esc(a.name), "", `<button class="chip out">Sign out</button>`),
    item("Export memory", "Chat and account, in one file.", `<a class="chip" href="/export${session === "" ? "" : "?session=" + encodeURIComponent(session)}">Download</a>`),
    item("Delete account", "Erases chat and memory for good.", `<button class="chip red del">Delete</button>`),
  ];
  const account = section_html("Sign-in and data", acts.join("") + kill);
  const links   = a.bills ? `<p class="foot"><a href="/pricing" target="_blank">Prices</a> · <a href="/terms.html" target="_blank">Terms</a> · <a href="/privacy.html" target="_blank">Privacy</a> · <a href="mailto:contact@higherorderco.com">Help</a></p>` : "";
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Account</h1>` + money + account + links;
}

// a section of the account page: its title, then its markup
function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

// a table (cls: its class) of inline markdown cells
function table_html(cls: string, head: string[], rows: string[][]): string {
  const cells = (row: string[], tag: string) => row.map((x) => `<${tag}>${spans_html(Md.span_parse(x))}</${tag}>`).join("");
  const body  = rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("");
  return `<div class="wide ${cls}"><table><tr>${cells(head, "th")}</tr>${body}</table></div>`;
}

export function block_html(b: Md.Block): string {
  switch (b.$) {
    case "Para": {
      return `<p>${b.x.map(spans_html).join("<br>")}</p>`;
    }
    case "Head": {
      const tag = "h" + Math.min(4, b.k + 1);
      return `<${tag}>${spans_html(b.x)}</${tag}>`;
    }
    case "Code": {
      const lang = b.k === "" ? "" : `<span class="lang">${esc(b.k)}</span>`;
      return `<pre>${copy_html(b.x)}${lang}<code>${esc(b.x)}</code></pre>`;
    }
    case "Rule": {
      return "<hr>";
    }
    case "Quot": {
      return `<blockquote>${b.x.map(block_html).join("")}</blockquote>`;
    }
    case "List": {
      const tag = b.k ? "ol" : "ul";
      const items = b.x.map((item) => `<li>${spans_html(item)}</li>`);
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${spans_html(cell)}</${tag}>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "Diff": {
      return diff_html(b.k, b.x);
    }
    case "File": {
      return file_html(b.k, b.n, b.x);
    }
  }
}

// a diff: its file and its lines added and dropped over its lines, each
// its number, its mark and its text (style.css hangs a wrap after the
// number); a ⋯ between hunks
function diff_html(file: string, hunks: Md.Line[][]): string {
  const all   = hunks.flat();
  const nw    = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds  = all.filter((l) => l.s === "+").length;
  const dels  = all.filter((l) => l.s === "-").length;
  const head  = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line  = (l: Md.Line) => `<span class="${MARKS[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" data-output="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}

// a tool result's shape, read from the result itself, never from the tool
// name. This drives colour, density and decoration for every tool alike.
type OutputKind = "empty" | "json" | "log" | "listing" | "table" | "error" | "diff" | "plain";

function output_kind(text: string): OutputKind {
  const raw = text.trim();
  if (raw === "") return "empty";
  if (/^--- /m.test(raw) && /^\+\+\+ /m.test(raw) && /^@@ /m.test(raw)) return "diff";
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  if ((raw.startsWith("{") || raw.startsWith("["))) {
    try { JSON.parse(raw); return "json"; } catch {}
  }
  const loggy = lines.filter((line) => /^\[?(error|fatal|warn|warning|info|debug|trace)\b/i.test(line.trim()) || /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(line.trim())).length;
  if (lines.length > 2 && loggy >= Math.max(2, Math.ceil(lines.length * 0.4))) return "log";
  const listing = lines.filter((line) => /^[-dlcbps][rwxSsTt-]{9}[.@+]?\s/.test(line) || /^\S+\s+\d+\s+\S+\s+\S+\s+\d+\s/.test(line)).length;
  if (lines.length > 1 && listing >= Math.ceil(lines.length * 0.7)) return "listing";
  if (/(?:^|\n)(?:error|fatal|failed|exception|traceback)\b/i.test(raw) || /\(exit [1-9]\d*/.test(raw)) return "error";
  const tabular = lines.filter((line) => (line.match(/\t/g)?.length ?? 0) >= 1 || (line.match(/\|/g)?.length ?? 0) >= 2).length;
  if (lines.length > 2 && tabular >= Math.ceil(lines.length * 0.8)) return "table";
  return "plain";
}

function line_tone(line: string): string {
  if (/^d[rwxSsTt-]{9}/.test(line)) return "dir";
  if (/^l[rwxSsTt-]{9}/.test(line)) return "link";
  if (/^-[rwxSsTt-]{9}/.test(line) && line[3] === "x") return "exec";
  if (/\b(error|fatal|failed|exception|traceback)\b/i.test(line)) return "err";
  if (/\b(warn|warning)\b/i.test(line)) return "warn";
  if (/\b(info|success|done|ok)\b/i.test(line)) return "ok";
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(line.trim())) return "meta";
  return "";
}

// a read's lines: framed as a diff is, the lines shown over them, each
// its number and its text; the result type, token colour and count come
// from what the output actually looks like
function file_html(shown: string, from: number, lines: string[]): string {
  const nw   = String(from + lines.length - 1).length;
  const kind = output_kind(lines.join("\n"));
  const lang = kind === "json" ? ' class="language-json"' : "";
  const head = `<span class="lang">${esc(shown)}<span class="out-kind">${kind}</span><span class="out-count">${lines.length} lines</span></span>`;
  const body = lines.map((x, k) => {
    const tone = line_tone(x);
    return `<span class="file${tone === "" ? "" : " tone-" + tone}"><i>${from + k}</i>${esc(x)}</span>`;
  }).join("");
  return `<pre class="diff" data-output="${kind}" style="--nw:${nw}ch">${head}<code${lang}>${body}</code></pre>`;
}

function spans_html(spans: Md.Span[]): string {
  return spans.map(span_html).join("");
}

function span_html(s: Md.Span): string {
  switch (s.$) {
    case "Text": { // the name, in the brand's font
      return esc(s.x).replaceAll("UniiChat", `<span class="brand">UniiChat</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${esc(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${esc(s.x)}</em>`;
    }
    case "Link": {
      return `<a href="${esc(s.k)}" target="_blank" rel="noopener">${esc(s.x)}</a>`;
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}
