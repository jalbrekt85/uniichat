// Remote
// ======
// The model server every clone of this fork talks to. This is the one
// value the fork owner sets when the public endpoint exists; users never
// see it, never type it, and never edit a file for it. `--server` and
// UNIICHAT_SERVER override it for local testing.
//
// Set this after `tailscale funnel 8000` (or your tunnel) gives the host,
// e.g. "https://jacobs-mac-studio.tailXXXX.ts.net".
export const DEFAULT_SERVER = "https://jacobs-mac-studio.tail9ddfd1.ts.net";

// The same model server on the home LAN, by Bonjour name (the Mac's
// LocalHostName, stable across DHCP). Setup probes it first; a response of
// any status means the LAN path works, including 503 while a model loads.
export const LAN_SERVER = "http://Jacobs-Mac-Studio.local:8000";

// Fallback for Windows/mDNS-less LAN clients. Kept only for the LAN; the
// probe validates it is an oMLX health response, so a remote network with
// an unrelated 192.168.4.22 does not get mistaken for the Mac.
export const LAN_IP_SERVER = "http://192.168.4.22:8000";
