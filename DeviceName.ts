// DeviceName
// ==========
// The one name this machine's unii runs under: what the agent sees in its
// Devices list and writes in a tool call. On macOS the local host name
// (Bonjour's, unique on its network), else the host's. UNII_DEVICE
// overrides it for tests. Nothing else computes or rewrites it: Device.ts
// and Term.ts import this, and the server reads whatever they announce.

import { spawnSync } from "node:child_process";
import * as os from "node:os";

const LOCAL = process.platform === "darwin" ? spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";

export const DEVICE = (process.env.UNII_DEVICE ?? "").trim() || LOCAL || os.hostname();
