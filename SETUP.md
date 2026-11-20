# Local-first setup

This fork runs Uniichat **on the user's machine** and points only the model
at a remote oMLX server. Tools (shell, read, write, edit) run locally; the
server never gets a shell on anyone's Mac.

## What the user needs

- macOS or Linux (Windows is native too; `Machine.ts` uses `cmd.exe` there).
- Network access to the model server.
- The repo.

## On the model server (once, on the M5 Ultra)

1. oMLX binds `0.0.0.0:8000` with the models (`glm-5.3-flash` for both
   the chat and its compactor; `qwen3-4b`, `qwen2.5-0.5b` and
   `qwen3.6-35b` are optional alternates), so the LAN can reach it. It
   still answers on loopback for Funnel.
2. Expose only that port publicly:
   ```bash
   tailscale funnel --bg 8000
   ```
3. Create one oMLX **sub-key per person** (admin UI → API keys, or
   `POST /admin/api/sub-keys` with `{ "key": "...", "name": "Mom" }`).
4. Give each person **their key**. They never type a URL. Do not expose
   8788.

Sub-keys are API-only, revocable, and cannot log into the admin UI.

## On each user's machine

1. Clone the repo.
2. The model host is compiled in: `DEFAULT_SERVER` in `Remote.ts`. The fork
   owner sets it once when the tunnel exists; **users never see or type a
   URL**. `--server` / `UNIICHAT_SERVER` override it for local testing.
3. Run:
   - macOS/Linux: `./setup`
   - Windows: double-click **setup.cmd**
4. A local page opens at `http://127.0.0.1:8788/setup`. Paste the
   **API key** there — never in the terminal. The work folder is shown
   (default `~/Uniichat`); change it by editing `~/.unii/config.json` or
   passing `--work` to setup.
5. Setup writes `~/.unii/config.json` and `~/.unii/local.json`, starts the
   local server and a headless device, opens that page, and installs
   autostart. Saving the key applies to the next model call; no restart.

No Bun preinstall: `setup` installs it if missing. No git required after the
clone. No accounts, no pairing codes, no public Uniichat server.

## Two network paths

Setup picks the path by probing, in this order:

| Order | Probe | Used when |
|---|---|---|
| 1 | `http://Jacobs-Mac-Studio.local:8000/health` (Bonjour) | same LAN, normal case |
| 2 | `http://192.168.4.22:8000/health`, only if its body is oMLX | same LAN, mDNS-less client (usually Windows) |
| 3 | `https://jacobs-mac-studio.tail9ddfd1.ts.net` (Funnel) | neither LAN probe responds |

If the machine’s own IPv4 is on `192.168.4.x` and **both** LAN probes fail,
setup exits with an error instead of using Funnel. That prevents a LAN user
from silently hairpinning through the internet.

### Scenario 2 — same LAN (no Funnel)

1. User joins the same Wi-Fi/LAN as the M5.
2. Clones the repo; runs `./setup` (macOS/Linux) or `setup.cmd` (Windows).
3. Setup probes the LAN and writes `~/.unii/local.json` with
   `http://Jacobs-Mac-Studio.local:8000` (or the `192.168.4.22` fallback).
4. Browser opens `http://127.0.0.1:8788/setup` if the key is missing; paste
   the personal oMLX key.
5. Chat at `http://127.0.0.1:8788`. Model traffic stays on the LAN; no
   Tailscale, no Funnel, no internet round trip.
6. Tools (shell/read/write/edit) run on the user’s machine.

If step 3 fails on a LAN machine, setup stops with an error. Check that
oMLX is listening on `0.0.0.0:8000` and macOS’s firewall allows it; do not
“fix” it by falling back to Funnel.

### Scenario 3 — remote network (Funnel)

1. User is on any network with internet.
2. Clones the repo; runs `./setup` / `setup.cmd`.
3. LAN probes time out; setup writes
   `https://jacobs-mac-studio.tail9ddfd1.ts.net`.
4. Browser opens `/setup` if the key is missing; paste the personal key.
5. Chat. Model traffic goes over Tailscale Funnel (HTTPS, public ingress);
   the key is required (`401` without it).
6. Tools run locally; the M5 stores no chat.

The same clone and the same `./setup` cover both scenarios. The difference
is only which model URL setup selects.

## Day to day

```bash
./uniichat start     # start server + device, open the chat
./uniichat stop
./uniichat status
./uniichat restart
```

Windows: `uniichat.cmd start|stop|status`.

- Chat: `http://127.0.0.1:8788` (the left rail's New chat starts a fresh tree)
- Chats: `~/.unii/users/1` (the first) and
  `~/.unii/users/1/sessions/<chat-id>` (each new one)
- Config: `~/.unii/config.json`
- Model server + key: `~/.unii/local.json`
- PIDs: `~/.unii/run/`
- Logs: `~/.unii/logs/server.log`, `device.log`

To change the model server or key, edit `~/.unii/local.json` and restart:
```json
{ "server": "https://host", "key": "sk-..." }
```

## Security model

- The API key is a bearer secret for **model calls only**. One per person;
  revoke by deleting the oMLX sub-key.
- LAN uses plain HTTP, so the key crosses the home LAN in clear. On a
  trusted home network that is the tradeoff for zero client setup. Funnel
  is HTTPS.
- oMLX is bound to `0.0.0.0:8000`, so its admin UI is also reachable on
  the LAN. It still requires the key; do not port-forward 8000 on the
  router.
- The agent's tools run on the user's machine, in their chosen work folder,
  as their user. They should not point it at their whole home.
- On macOS, screen control is on by default: grant Screen Recording and
  Accessibility to the app that runs the server/device (or terminal).
  `UNII_COMPUTER=0` turns it off.
- The M5 Ultra stores no chats; each user's `~/.unii` is local.
- Do not expose `8788`; only the model endpoint (`8000`) is public.

## Tests

```bash
bun tests/e2e.ts                 # macOS/Linux: setup -> server -> device -> shell -> model
docker run --rm -v "$PWD":/app -w /app oven/bun:1 bun tests/e2e.ts   # Linux, fresh container
```

Windows: `tests/win-shell.ts` compiles to a Windows exe and exercises
`shell`/`read`/`write`; the full server+device loop was verified with Windows
Bun under Wine (see `tests/`). `bun test --isolate` runs the upstream suite.
