// DeviceName
// ==========
// The one name this machine's unii runs under: what the agent sees in its
// Devices list and writes in a tool call. On macOS it is Bonjour's local
// host name; there is deliberately no os.hostname() fallback, because that
// can announce a different identity ("<name>.local"). UNII_DEVICE is the
// explicit override for tests. Device.ts and Term.ts import this; nothing
// else computes or rewrites the name.

import { spawnSync } from "node:child_process";
import * as os from "node:os";

const LOCAL = process.platform === "darwin" ? spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const OVERRIDE = (process.env.UNII_DEVICE ?? "").trim();

function canonical(): string {
  if (OVERRIDE !== "") {
    return OVERRIDE;
  }
  if (process.platform === "darwin") {
    if (LOCAL === "") {
      throw new Error("DeviceName: `scutil --get LocalHostName` returned no name; refusing to announce a different device identity");
    }
    return LOCAL;
  }
  return os.hostname();
}

export const DEVICE = canonical();
