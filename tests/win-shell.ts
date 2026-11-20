import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Machine } from "../Machine.ts";

const work = path.join(os.tmpdir(), "uniichat-win-shell");
fs.mkdirSync(path.join(work, "main"), { recursive: true });
const signal = new AbortController().signal;

const shell = await Machine.run({ name: "shell", input: { command: "echo win-shell-ok > proof.txt" }, cwd: "main" }, work, signal);
const proof = fs.readFileSync(path.join(work, "main", "proof.txt"), "utf8").trim();
const write = await Machine.run({ name: "write", input: { path: "x.txt", content: "hello" }, cwd: "main" }, work, signal);
const read  = await Machine.run({ name: "read", input: { path: "x.txt" }, cwd: "main" }, work, signal);
console.log(JSON.stringify({ platform: process.platform, shell, proof, write, read }));
if (process.platform !== "win32" || proof !== "win-shell-ok" || read.text.includes("hello") === false) {
  process.exit(1);
}
