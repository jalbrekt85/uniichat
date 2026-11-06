# The Watchdog (final — implement now, run nothing)

Implement exactly as discussed. No test runs, no rebuild, no server restart — code only (a uniichat agent is live; file edits don't affect the running server until it's restarted).

## Files

1. **`Watchdog.ts` (new)** — the whole watchdog: `Dog` state (`buf`/`bytes` unchecked thoughts, `run`/`took` in-flight check, `flush` turn-ended, `fired` one-report-per-turn); `MIN=1024` bytes before a check, `MOST=64KB` buffer bound; classifier `PROMPT` (one-word BAD/OK answer, terse repo voice, OK-cases for user-approved minimal work); `CALL_OUT` template quoting the caught passage; `mind()` (append + pump), `turn_end()` (flush remainder or reset), `pump()` (serial, one check in flight), `check()` (task context = up to 3 recent user messages of the turn + batch; `AskAI.ask` on `config.WATCHDOG`, no tools/searches; holds `chat.posts` until it lands so a late report reaches even a viewer-less chat; failed call keeps its batch), `text()` (input builder), `fire()` (log `[Watchdog]` work message + `Chat.take`, mirroring `Chat.report` — mid-turn between tool calls, else a new turn; liveness-guarded).

2. **`Server.ts`** — import Watchdog; `export type Chat` (so Watchdog can type it); `dog: Dog` field + init in `Chat.open`; hook in `Chat.on`'s `mind` branch (main agent only: `agent === null && config.WATCHDOG !== null`); `Watchdog.turn_end(chat)` in `Chat.turn`'s `finally` after `chat.busy = false`.

3. **`Config.ts`** — `watchdog` config key, default `zai-api:glm-5.3-flash:low:slow`, `""` disables (AGENTS pattern).

4. **`AskAI.ts`** — `Served` union + `"watchdog"`.

5. **`View.ts`** — `SERVED` labels: `["watchdog check", "watchdog checks"]`.

6. **`prompt.txt`** — short paragraph in Turns: a watchdog reads your thoughts; its `[Watchdog]` report means stop, no more tool calls, discuss the whole-repo foundational solution with the user.

7. **`README.md`** — `watchdog` config bullet.

8. **`watchdog.test.ts` (new)** — Server.test.ts's spawned-process pattern with faked `AskAI.ask` (`AskAI.tie`): BAD fires a `[Watchdog]` work message into the running call; OK fires nothing; sub-MIN thoughts batch until turn end (one check covering both); one report per turn; a thought-free turn makes zero watchdog calls. Watchdog calls identified by system prompt (the report message triggers a real compaction call too).

## After approval

Write all files, touch nothing else. No bash runs (you'll run `bun test watchdog.test.ts` and restart the server when ready).