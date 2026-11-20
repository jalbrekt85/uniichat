// Sessions
// ========
// A user's chats. Each is a directory holding one Memory.ts: its own
// messages (main/), its own summary tree (tree/), its own view.json, its
// own images and agent logs. So every session is one chat that never
// ends, with its own binary tree; nothing is shared between them but the
// user, their wallet and their devices.
//
// The first chat ("default") is the user's own directory, as it was
// before sessions existed, so an existing chat is never moved, copied or
// rewritten. Each new chat is a directory under sessions/, named by a
// UUID; this module is the only place that knows a session's id, path,
// title and order. Server.ts names a session, never a path.
//
// A session's title is the first line of its first user message, kept in
// session.json beside Memory's own files; the default chat adopts its
// first message the first time it is opened after this feature. Titles
// are only for the switcher: losing one loses no chat.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as config from "./Config.ts";

// Types
// =====

// a chat in the switcher: its id, when it last moved, how many messages
// it holds, its title ("" until its first user message), and whether it
// is hidden from the list (its files stay: only the UI leaves it)
export type Info = { id: string; at: number; messages: number; title: string; archived: boolean; work: string };

// session.json: what the switcher needs without reading a chat
type Meta = { id?: string; title?: string; at?: number; archived?: boolean; work?: string };

// Constants
// =========

const FILE = "/session.json";
const WORKS = "/workspaces.json";
const ID   = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const SLOT = 16;
const TTL  = 1000;

// the last list made for a user (a state goes to every view, often), and
// when: a new session or a title invalidates it
const LISTS = new Map<string, { at: number; list: Info[] }>();

// Sessions
// ========

export namespace Sessions {

  // the user's first chat, in their own directory
  export const DEFAULT = "default";

  // whether `id` may name a session: the default, or letters, digits, "_"
  // and "-", never a path
  export function valid(id: string): boolean {
    return id === DEFAULT || ID.test(id);
  }

  // a user's chats
  export function users(): string[] {
    try {
      return fs.readdirSync(config.DIR + "/users", { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  // the user's directory (the default chat) and its new chats' parent
  export function root(user: string): string {
    return config.DIR + "/users/" + user;
  }

  export function home(user: string): string {
    return root(user) + "/sessions";
  }

  // where a session keeps its Memory: the legacy default in place
  export function dir(user: string, id: string): string {
    return id === DEFAULT ? root(user) : home(user) + "/" + id;
  }

  // an id as a request may carry it: a valid one, else the default
  export function pick(id: string | null | undefined): string {
    return id !== null && id !== undefined && valid(id) ? id : DEFAULT;
  }

  // Work dirs
  // ---------

  // a path as the user typed it: ~, ., .. and relative all resolved
  function absolute(value: string): string {
    const text = value.trim();
    const full = text === "~" || text.startsWith("~/") ? os.homedir() + text.slice(1) : text;
    return path.resolve(full);
  }

  // the fork's work root, the one every chat before workspaces used
  export function work_default(): string {
    return absolute(config.WORK);
  }

  // a path if it is a directory now, else null
  export function work_check(value: string): string | null {
    if (value.trim() === "") {
      return null;
    }
    const full = absolute(value);
    try {
      return fs.statSync(full).isDirectory() ? full : null;
    } catch {
      return null;
    }
  }

  // every work dir the rail shows: the default first, then the ones added,
  // then any a chat names that is not on the list yet (an older chat)
  export function works(user: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (value: string) => {
      const full = absolute(value);
      if (!seen.has(full)) {
        seen.add(full);
        out.push(full);
      }
    };
    let saved: string[] = [];
    try {
      const value = JSON.parse(fs.readFileSync(root(user) + WORKS, "utf8"));
      if (Array.isArray(value?.works)) {
        saved = value.works.filter((item: unknown) => typeof item === "string") as string[];
      }
    } catch {}
    for (const value of saved) {
      if (absolute(value) !== work_default()) {
        add(value);
      }
    }
    add(work_default());
    for (const chat of list(user)) {
      add(chat.work);
    }
    return out;
  }

  // add a work dir the rail keeps even before it has a chat
  export function work_add(user: string, value: string): string | null {
    const full = work_check(value);
    if (full === null) {
      return null;
    }
    const all = works(user).filter((work) => work !== full && work !== work_default());
    try {
      fs.mkdirSync(root(user), { recursive: true, mode: 0o700 });
      fs.writeFileSync(root(user) + WORKS, JSON.stringify({ works: [full, ...all] }, null, 1) + "\n");
    } catch {
      return null;
    }
    return full;
  }

  // a new chat, created once (a repeated id keeps it); a UUID when none
  // is given. The caller's Chat.open starts its Memory.
  export function create(user: string, id?: string, work?: string): string {
    const sid = id === undefined ? crypto.randomUUID() : id;
    if (!valid(sid)) {
      throw new Error("A session id is 8 to 64 letters, digits, _ or -.");
    }
    const dir = Sessions.dir(user, sid);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(dir + FILE)) {
      write(user, sid, { id: sid, title: "", at: Date.now(), work: work ?? work_default() });
    }
    Sessions.forget(user);
    return sid;
  }

  // a session's directory, made if a valid new id asked for one; the
  // default one is made by Memory.load
  export function ensure(user: string, id: string): string {
    const sid = Sessions.pick(id);
    if (sid !== DEFAULT) {
      Sessions.create(user, sid);
    }
    return Sessions.dir(user, sid);
  }

  // the chats of a user, newest first. The default chat is the user's
  // own directory, and is listed once it has been opened; a chat never
  // opened is not listed.
  export function list(user: string): Info[] {
    const saved = LISTS.get(user);
    if (saved !== undefined && Date.now() - saved.at < TTL) {
      return saved.list.map((info) => ({ ...info }));
    }
    const out: Info[] = [];
    if (fs.existsSync(root(user) + "/main.index") || fs.existsSync(root(user) + "/view.json")) {
      const first = Sessions.info(user, DEFAULT);
      if (first !== null) {
        out.push(first);
      }
    }
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(Sessions.home(user), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== DEFAULT && Sessions.valid(entry.name))
        .map((entry) => entry.name);
    } catch {}
    for (const id of ids) {
      const info = Sessions.info(user, id);
      if (info !== null) {
        out.push(info);
      }
    }
    out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    LISTS.set(user, { at: Date.now(), list: out.map((info) => ({ ...info })) });
    return out;
  }

  export function info(user: string, id: string): Info | null {
    const dir = Sessions.dir(user, id);
    if (!fs.existsSync(dir)) {
      return null;
    }
    const saved = meta(user, id);
    const index = stat(dir + "/main.index");
    const view = stat(dir + "/view.json");
    const at = Math.max(
      saved.at ?? 0,
      index?.mtimeMs ?? 0,
      view?.mtimeMs ?? 0,
      saved.at === undefined && index === null && view === null ? (stat(dir)?.mtimeMs ?? 0) : 0,
    );
    return {
      id,
      at,
      messages: index === null ? 0 : Math.floor(index.size / SLOT),
      title: saved.title ?? "",
      archived: saved.archived === true,
      work: saved.work ?? work_default(),
    };
  }

  // the switcher's name for a chat: its title, else "" (the client names
  // it)
  export function title(user: string, id: string): string {
    return meta(user, id).title ?? "";
  }

  // a chat's title, once: the first user message's first line. Later
  // messages never overwrite it.
  export function title_set(user: string, id: string, text: string): void {
    const saved = meta(user, id);
    if ((saved.title ?? "") !== "") {
      return;
    }
    const title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    if (title === "") {
      return;
    }
    try {
      write(user, id, { ...saved, id, title, at: saved.at ?? Date.now() });
    } catch {
      return; // a title is a convenience: a chat opens without one
    }
    Sessions.forget(user);
  }

  // a chat hidden from the switcher, or back: only session.json changes,
  // so every message, tree and image on disk stays exactly as it was
  export function archive(user: string, id: string, on: boolean): boolean {
    if (!Sessions.valid(id)) {
      return false;
    }
    if (!fs.existsSync(Sessions.dir(user, id))) {
      return false;
    }
    const saved = meta(user, id);
    try {
      write(user, id, { ...saved, id, archived: on });
    } catch {
      return false;
    }
    Sessions.forget(user);
    return true;
  }

  // a new state lists again
  export function forget(user: string): void {
    LISTS.delete(user);
  }

  // Meta
  // ----

  function meta(user: string, id: string): Meta {
    try {
      const value = JSON.parse(fs.readFileSync(Sessions.dir(user, id) + FILE, "utf8"));
      return value !== null && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  // written whole, then moved in place; no chat waits on it
  function write(user: string, id: string, meta: Meta): void {
    const file = Sessions.dir(user, id) + FILE;
    fs.mkdirSync(Sessions.dir(user, id), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + ".new", JSON.stringify(meta) + "\n");
    fs.renameSync(file + ".new", file);
  }

  function stat(file: string): fs.Stats | null {
    try {
      return fs.statSync(file);
    } catch {
      return null;
    }
  }

}
