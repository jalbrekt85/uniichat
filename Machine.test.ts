// Machine test
// ============
// `bun test Machine.test.ts`. The device tools' answers at their edges.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Machine } from "./Machine.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-machine-");

test("a read past a file's end says so, never an empty range", () => {
  const file = DIR + "/three";
  fs.writeFileSync(file, "a\nb\nc\n");
  expect(Machine.read(file, 3, Infinity, 0)).toEqual({ text: "c\n[lines 3-3 of 3]", fail: false });
  expect(Machine.read(file, 9, Infinity, 0)).toEqual({ text: "No lines from line 9: the file has 3.", fail: true });
  expect(Machine.read(file, 2, 0, 0)).toEqual({ text: "No lines from line 2: the file has 3.", fail: true });
});

test("a shell's output is decoded whole: a char split over writes, a broken one at its end", async () => {
  const live = new AbortController().signal;
  const split = await Machine.shell(DIR, "printf 'a\\303'; sleep 0.1; printf '\\251b'", live);
  expect(split.text).toStartWith("aéb\n(exit 0 in ");
  const broken = await Machine.shell(DIR, "printf 'ab\\303'", live);
  expect(broken.text).toStartWith("ab�\n(exit 0 in ");
});

test("an edit batch names its file once: later edits inherit it, or the top-level path covers them", () => {
  const file = DIR + "/edit-inherit";
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  // the shape the model reaches for: the path on the first edit only
  const first = { edits: [{ path: file, old: "one", new: "1" }, { old: "three", new: "3" }] };
  const both = Machine.edit(DIR, first.edits, first.path);
  expect(both.fail).toBe(false);
  expect(fs.readFileSync(file, "utf8")).toBe("1\ntwo\n3\n");
  // the MultiEdit shape: the path at the top, every edit pathless
  const second = { path: file, edits: [{ old: "1", new: "ONE" }, { old: "3", new: "THREE" }] };
  const top = Machine.edit(DIR, second.edits, second.path);
  expect(top.fail).toBe(false);
  expect(fs.readFileSync(file, "utf8")).toBe("ONE\ntwo\nTHREE\n");
  // no path anywhere: said so, nothing changed
  const third = { edits: [{ old: "ONE", new: "x" }] };
  const none = Machine.edit(DIR, third.edits, third.path);
  expect(none.fail).toBe(true);
  expect(none.text).toContain("no path given");
  expect(fs.readFileSync(file, "utf8")).toBe("ONE\ntwo\nTHREE\n");
});
