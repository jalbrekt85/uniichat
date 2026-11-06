# Harness error handling: surface terminal vendor errors, never hang on “compressing”

Status: implemented (2026-10-31)

> 2026-10-31, revised per the user: NOTHING retries for ever. The 60 s
> patient loop is gone — summaries use the turns' own exponential tries
> (`Agent.step`, `TRIES`) and then fail the side (`Memory.failed`), which
> the user's next message clears and re-pumps. Balance errors are never
> retried anywhere (one request, then the vendor's words in the chat).
Scope: `Agent.ts`, `AskAI.ts`, `Memory.ts`, `Server.ts`, `failsafe.test.ts`

## Summary

A terminal vendor error (HTTP 429, code `1113`, “Insufficient balance or no
resource package”) is currently treated as a transient “busy” condition. That
causes three failures at once:

1. **The user sees the wrong error.** The chat says “The AI service is busy…” and
   finally “No reply: the AI service is busy or unavailable right now.” The
   actual API message and code are never shown.
2. **A turn retries a non-retryable error eight times.** `Agent.step` sleeps
   2 + 4 + 8 + 16 + 32 + 64 + 128 = **254 s** before giving up.
3. **Compaction can hang forever.** The compactor is a `patient: true` call.
   `AskAI.ask` retries patient calls every 60 s **indefinitely** for any end that
   is not `fail` or `lost`. `Memory.settle` waits for those summaries to be
   built, and the only escape it knows is `mem.hold[0]` (the payer’s “no
   credit” reason). A vendor-side `1113` never sets it, so the chat sits on
   “compressing earlier messages…” with `chat.busy = true` and never recovers.

The fix is not to remove retries. It is to **classify** errors:

- **transient** (network, 408/409/5xx, a rate limit with no terminal code):
  retry with backoff, keep the generic “busy” message, keep patient summary
  retries;
- **terminal** (billing/quota `1113`/`1309`/`1302`, auth `401`/`403`, invalid
  request `400`/`422`, malformed model input): do not retry, surface the exact
  code and message, fail summaries immediately, and end the turn instead of
  looping.

## Observed failure

With a z.ai key that has no active plan and a zero balance, both models return:

```http
POST https://api.z.ai/api/anthropic/v1/messages
HTTP/429

{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "code": "1113",
    "message": "[1113][Insufficient balance or no resource package. Please recharge.]"
  },
  "request_id": "…"
}
```

`POST /api/anthropic/v1/messages/count_tokens` still returns HTTP 200, so the
key is syntactically valid; only inference is refused.

The observed chat sequence was:

```text
The AI service is busy: asking again in 2 s.
The AI service is busy: asking again in 4 s.
The AI service is busy: asking again in 8 s.
The AI service is busy: asking again in 16 s.
The AI service is busy: asking again in 32 s.
The AI service is busy: asking again in 64 s.
The AI service is busy: asking again in 128 s.
No reply: the AI service is busy or unavailable right now. Send a message to try again.
```

The user’s next message then queued and the UI showed:

```text
compressing earlier messages…
```

for roughly ten minutes. The server log showed two consecutive retry cycles,
each about 4m16s (254s), which matches two `Agent.step` runs. The vendor was
never returning a transient error; every request was a fast `429/1113`.

## Root cause chain

### 1. `Agent.passing` treats every 429 as retryable

`Agent.ts:414`:

```ts
export function passing(res: Response): boolean {
  const should = res.headers.get("x-should-retry");
  const busy = [408, 409, 429].includes(res.status) || res.status >= 500;
  return should === "true" || (should !== "false" && busy);
}
```

`1113` is a billing/quota refusal, not a rate limit. It is still classified as
`busy`, so `Agent.step` enters the retry loop.

### 2. `Agent.step` hides the error and retries it

`Agent.ts:229-275` retries `busy` up to `TRIES = 8`:

```ts
const wait = after > 0 ? after : 2 ** k;
run.on({ $: "Entry", kind: "mind", text: "The AI service is busy: asking again in " + wait + " s." });
await Machine.nap(wait * 1000, signal);
```

It only logs `step.why` when the step is already `down` (`Agent.ts:283`), and
that log goes to `console.error`, not the chat. After eight tries it returns
`{ ...step, stop: "down" }`.

### 3. `Agent.loop` replaces the vendor message with `BUSY`

`Agent.ts:186-190`:

```ts
if (step.stop === "down" || step.stop === "lost" || step.stop === "fail") {
  end.text ||= step.stop === "down" ? BUSY : step.why;
  end.stop = step.stop;
  return;
}
```

`BUSY` is `Agent.ts:120`:

```ts
const BUSY = "the AI service is busy or unavailable right now";
```

So the exact `HTTP 429: …1113…` text that `Agent.send` built is discarded for
`down` ends. This is deliberate in the current header comment (“a vendor’s
errors speak of the server’s account, not the user’s”), but it is the wrong
policy for terminal billing/auth errors in a self-hosted chat: the operator
needs the actionable error.

### 4. Patient summaries retry forever

`Memory.ask` (`Memory.ts:786-790`) creates the compactor call with
`patient: true`. `AskAI.ask` (`AskAI.ts:157-178`) does:

```ts
const wait = ask.patient === true && !end.ok && end.stop !== "fail" && end.stop !== "lost";
if (wait) {
  await Machine.nap(AGAIN, halt.signal); // AGAIN = 60e3
}
...
call = AskAI.start(tie, feed.on);
end = await call.done;
```

`1113` ends in `stop: "down"`, not `fail`/`lost`, so a summary never stops
retrying. There is no maximum number of patient retries.

### 5. `Memory.settle` has no terminal-vendor escape

`Memory.settle` (`Memory.ts:962-977`) resolves only when the summaries before
`end` are built, the signal aborts, or `mem.hold[0]` is non-null:

```ts
const built = Memory.first(mem) >= end;
const why = signal.aborted ? "Stopped." : built ? null : mem.hold[0];
```

`mem.hold[0]` is the **payer’s** “no credit for summaries” reason (set by
`Billing.ts`/`Memory.starts`). A vendor `1113` is not a payer hold, so
`hold[0]` stays `null`, `settle` never resolves, and `Chat.call` never reaches
`AskAI.ask` for the user’s message.

### 6. The UI label is derived from `busy + queue + old memory`

`Server.ts:1083-1086`:

```ts
const summing = chat.busy && chat.wait.length > 0 && Memory.first(chat.mem) < Chat.from(chat);
return summing ? SUMMARIES : "";
```

While `settle` hangs, `chat.busy` stays true, the user’s message stays in
`chat.wait`, and the chat has old memory, so the UI shows `SUMMARIES`
(“compressing earlier messages…”). The label is not evidence that a summary
is progressing; it is evidence that the turn is stuck.

### 7. Queued messages multiply the wait

`Chat.turn` (`Server.ts:503-525`) loops while `chat.wait.length > 0`. When the
user sends a message during a failing turn, it queues; after the first 254s
cycle, the next `Chat.call` can start another 254s cycle on the same terminal
error. That is how a single `1113` becomes a ten-minute stall.

## Fix

### 1. Classify the error before retrying

Add a small classifier in `Agent.ts`, used by `Agent.send`:

```ts
function terminal(res: Response, body: string): boolean {
  const code = (() => {
    try { return String(JSON.parse(body)?.error?.code ?? ""); } catch { return ""; }
  })();
  if (res.status === 429) {
    return ["1113", "1309", "1302"].includes(code);
  }
  return res.status >= 400 && res.status < 500 &&
    res.status !== 408 && res.status !== 409;
}

function passing(res: Response): boolean { /* existing transient check, unchanged */ }
```

`terminal()` is checked before `passing()`; a terminal code wins over a stray
`x-should-retry: true`. If the vendor explicitly sets `x-should-retry: false`,
`passing()` already treats it as non-retryable.

The rule:

- `401`, `403` → terminal (auth).
- `400`, `422`, and every other 4xx except `408`, `409`, and a non-terminal
  `429` → terminal (invalid input/route); do not burn eight retries on a
  request the vendor has already rejected.
- 429 with code `1113` (balance/resource package), `1309` (plan expired), or
  `1302` (rate/quota terminal form) → terminal.
- 408, 409, 5xx, network/stream failures → retry.
- 429 without a terminal code → retry, honoring `retry-after`.

`Agent.send` already reads the body for the error message:

```ts
const text = await res.text();
const why = "HTTP " + res.status + ": " + Agent.reason(text);
const stop = terminal(res, text) ? "terminal" : "busy";
step = Agent.fail(why, [], stop);
```

Keep `Agent.reason` as the source of the exact vendor message; it already
extracts `error.message`.

### 2. Add a terminal stop and stop retrying it

Add `"terminal"` to `Step.stop` (`Agent.ts:83-90`) and to `End.stop`
(`AskAI.ts:112-119`), then handle it before the retry logic in `Agent.step`:

```ts
if (step.stop === "terminal") {
  console.error(model + ": " + step.why.slice(0, 300)); // once, for diagnostics
  return step; // no room hold, no "asking again", no nap
}
```

`Agent.loop` must not replace the terminal message with `BUSY`:

```ts
if (step.stop === "down" || step.stop === "lost" ||
    step.stop === "fail" || step.stop === "terminal") {
  end.text ||= step.stop === "down" ? BUSY : step.why;
  end.stop = step.stop;
  return;
}
```

For terminal errors, `end.stop` should be `"terminal"` and `end.text` should be
the vendor’s `HTTP 429: …1113…` text. `Chat.failed` will then show:

```text
No reply: HTTP 429: [1113][Insufficient balance or no resource package. Please recharge.]. Send a message to try again.
```

If the hosted product needs to hide account details, redact the message at the
`Billing`/`Chat` boundary, but keep the code and action. Do not replace a
terminal error with `BUSY`.

### 3. Stop patient summary retries on terminal errors

`AskAI.ask` (`AskAI.ts:171`):

```ts
const wait = ask.patient === true && !end.ok &&
  end.stop !== "fail" && end.stop !== "lost" && end.stop !== "terminal";
```

Transient `down`/`busy` ends still retry every `AGAIN` (60s). Terminal ends
return immediately. This is the single most important change for the
“compressing forever” bug.

### 4. Give `Memory` a terminal failure state and release `settle`

`Memory` needs to distinguish “summaries are waiting for credit” from
“summaries can never be built because the vendor refused the call.”

Add to the `Memory` state (near `hold`):

```ts
// why summaries cannot be built now: a terminal vendor error, cleared when
// the user retries (a new turn) or the account changes
failed: string | null;
```

`Memory.build` already throws when `!end.ok && end.stop !== "fail"`. Make the
terminal case a typed error instead of a message match:

```ts
export class Terminal extends Error {}

if (lines.length === 0 && !end.ok && end.stop !== "fail") {
  throw end.stop === "terminal"
    ? new Terminal(end.text)
    : new Error(end.text);
}
```

`Memory.job`’s catch then stores it and wakes the waiters:

```ts
.catch((err) => {
  if (err instanceof Terminal) {
    Memory.fail(mem, err.message);
  }
  console.error("compactor: node " + l + "/" + i + ": " + (err?.message ?? err));
});
```

Ordering matters: `Memory.job` currently deletes the busy slot and calls
`Memory.pump` in a `.finally` that runs **before** `.catch`. On a terminal
error that would start the next summary job before `mem.failed` is recorded.
Move the delete/pump/fit into explicit success and failure handlers, or set
`mem.failed` in the failure path before `pump`; otherwise one more summary can
enter the same retry loop.

Add the notification helper next to `settle`:

```ts
export function fail(mem: Memory, message: string): void {
  if (mem.failed !== null) {
    return;
  }
  mem.failed = message;
  [...mem.wait].forEach((check) => check()); // resolve Memory.settle now
  Memory.pump(mem);                          // starts() returns [] while failed
}
```

`Memory.fail` must set `mem.failed` before notifying; the `settle` callback
reads it.

`Memory.starts`/`pump` must not start new summary jobs while `mem.failed` is
set:

```ts
if (mem.failed !== null) {
  return [];
}
```

`Memory.settle` must return the terminal reason instead of waiting:

```ts
const why = signal.aborted
  ? "Stopped."
  : built
    ? null
    : (mem.failed ?? mem.hold[0]);
```

Then `Chat.call` gets a non-null `why`, calls `Chat.failed(chat, why)`, and
returns false. `Chat.turn`’s `finally` clears `chat.busy`; because `mem.failed`
is set it keeps `chat.wait` queued (section 5). The “compressing” label
disappears on the same tick.

Clear `mem.failed` only when a **new** turn starts from a user action and no
turn is running, so a fixed key/plan can retry:

```ts
// Server.take: a new message, no turn running
if (!chat.busy) {
  chat.mem.failed = null;
  Chat.turn(chat);
}
```

Do not clear it automatically in a tight loop or while the terminal turn is
still winding down; only clear it on a new user action or an explicit retry.

### 5. End the turn on a terminal error; do not requeue into another retry

`Chat.ended` currently returns `!halt.signal.aborted` and `Chat.turn` keeps
looping while `chat.wait.length > 0`. For a terminal error, return false:

```ts
if (!end.ok && end.stop === "terminal") {
  chat.mem.failed = end.text; // account cannot make calls: stop summaries too
  Chat.failed(chat, end.text);
  return false; // end the turn; leave queued messages for the user
}
```

Setting the same `mem.failed` on a terminal turn error (not only on a failed
summary) is what makes the `finally` keep the queue and stops the compactor
from starting more jobs. The queued messages stay in `chat.wait` with a visible
“No reply: …” note.

`Chat.turn`’s `finally` currently clears `chat.wait` unconditionally; when
`chat.mem.failed` is set, keep the queue:

```ts
} finally {
  const keep = chat.mem.failed !== null;
  ...
  chat.wait = keep ? chat.wait : [];
  chat.busy = false;
}
```

The user can fix the account and send again; the queued message plus the new
one then run. Do not automatically start another 254s cycle on the same
terminal error.

### 6. Make the compaction label accurate

`Server.ts:1085` should not infer “compressing” from `busy + queue + old
memory` alone:

```ts
const pending = chat.mem.failed === null && chat.mem.calls.size > 0 &&
  Memory.first(chat.mem) < Chat.from(chat);
const summing = chat.busy && chat.wait.length > 0 && pending;
```

If `mem.failed` is set, `pending` is false and `Chat.waits` returns `""`; the
`Chat.failed` note carries the exact error. No new `View.ts` wait value is
required: the error is already a chat note. The requirement is that a terminal
error is never presented as “compressing earlier messages…”.

### 7. Keep the existing transient behavior

The existing `failsafe.test.ts` rate-limit test (`LIMIT`, a 429 with
`retry-after: 1` and no terminal code) must keep passing:

- it retries;
- it emits “The AI service is busy: asking again in 1 s.”;
- it logs the vendor words once;
- it eventually succeeds.

The existing outage test uses HTTP 400 with the Anthropic “credit balance is
too low” message. Under the new policy 400 is terminal, so that fixture no
longer represents a transient outage. Split it:

- **Outage test:** fake a 503 (or a 429 without a terminal code/with
  `retry-after`). Summaries must keep retrying, the turn must end `BUSY`, and
  no `mem.failed` is set. When the vendor recovers, the summaries build.
- **Terminal test:** fake the 400/1113. Summaries stop, `Memory.settle`
  returns the message, the turn ends with the message, and no further summary
  jobs start. After the vendor recovers, clear `mem.failed` and call
  `Memory.pump` explicitly; summaries resume. The old `completes` helper must
  do this clear, or that test will never resume.

Do not simply change the old expectation: that would leave the outage path
untested.

## Tests to add in `failsafe.test.ts`

1. **`1113` is requested once and surfaced.**
   - Fake vendor returns `429` with
     `{"error":{"type":"rate_limit_error","code":"1113","message":"[1113][Insufficient balance or no resource package. Please recharge.]"}}`.
   - `AskAI.ask` returns `ok: false`, `stop: "terminal"`, `text` contains
     `1113` and `Insufficient balance`.
   - No `mind` “asking again” entries; the vendor’s call count is 1.

2. **A summary with `1113` releases `Memory.settle`.**
   - `Memory.push` starts summaries; the vendor returns `1113`.
   - `Memory.settle` resolves with the `1113` message within a tick, not after
     60s/254s.
   - `mem.busy.size === 0`; `mem.failed` is set; `Memory.pump` starts no new
     jobs.
   - A turn waiting on those summaries produces
     `No reply: HTTP 429: …1113…`, not
     `No reply: the AI service is busy…`.

3. **A queued message after a terminal error does not start another retry
   cycle.**
   - After the terminal failure, add a second message; assert the vendor is
     not called again until the user clears/retries the error.

4. **Transient `5xx`/`429` still retries.**
   - Keep the existing `limited` test; add a `503` case if needed.
   - Assert `BUSY` and the backoff minds remain for transient errors.

5. **Auth `401`/`403` is terminal and surfaced.**
   - Same as `1113`, with `Insufficient permissions`/`invalid key` text.

6. **UI wait value.**
   - With `mem.failed` set, `Chat.waits` returns `""`, not `SUMMARIES`; the
     `Chat.failed` note carries the error.

The tests already run timers 1000× fast (`fast()` in `failsafe.test.ts`), so an
accidental infinite patient loop shows up as a timeout rather than a ten-minute
hang.

## Acceptance criteria

- A terminal `429/1113`, `401`, `403`, `400`, or `422` is **not retried** by
  `Agent.step`; the vendor is called once.
- The chat/compaction displays the vendor’s code and message (or a redacted
  equivalent) instead of “the AI service is busy or unavailable right now.”
- A summary that receives a terminal error makes `Memory.settle` resolve with
  that error on the next tick; `chat.busy` clears; “compressing earlier
  messages…” does not persist.
- A queued message after a terminal error does not trigger another 254s/∞
  retry cycle; the turn ends with a visible error and the user can retry after
  fixing the account.
- Transient network/5xx/rate-limit errors still retry with backoff and still
  use the generic “busy” message.
- The existing tests for outages, summaries, credit holds, and single flight
  continue to pass; the `LIMIT` rate-limit test still retries and succeeds.

## Non-goals

- Do not remove retries for transient errors.
- Do not expose account secrets (customer id, invoice id, key) in the UI; the
  vendor’s `error.message` is the intended payload, redacted if the hosted
  product requires it.
- Do not change the memory tree, the compactor model, or the billing model.
- Do not add a global timeout to normal compaction; the fix is terminal-error
  propagation, not a timer.

## Minimal patch order

1. `Agent.ts`: classifier + `Step.stop: "terminal"`; no retry on terminal;
   `Agent.loop` preserves `step.why`.
2. `AskAI.ts`: patient loop stops on `"terminal"`.
3. `Memory.ts`: `failed` state; `job` stores terminal errors; `pump`/`starts`
   stop; `settle` returns `failed`.
4. `Server.ts`: `Chat.ended` returns false for terminal; `Chat.turn` keeps
   `chat.wait` when `failed`; `Chat.waits` does not report `SUMMARIES` when
   `failed`; clear `failed` on a new user action.
5. `failsafe.test.ts`: `1113`, `401`, summary-settle, queued-message, and
   transient-regression tests.

## Evidence appendix

- Error response (observed):
  `HTTP 429`, `type: rate_limit_error`, `code: 1113`,
  `message: [1113][Insufficient balance or no resource package. Please recharge.]`.
- `count_tokens` still returns `HTTP 200`, so the key is accepted for the free
  count endpoint; only inference is refused.
- The account state at the time: no active coding plan (`subscription/list`
  empty) and zero account balance. This is terminal for inference, not a
  transient outage.
- Server log: two 254s retry cycles (`2+4+8+16+32+64+128` seconds each), then
  the generic `BUSY` note; the UI stayed on “compressing earlier messages…”.
- Code paths: `Agent.passing` (`Agent.ts:414`), `Agent.step`
  (`Agent.ts:229-275`), `Agent.loop` (`Agent.ts:186-190`), `AskAI.ask`
  (`AskAI.ts:157-178`), `Memory.ask` (`Memory.ts:786-790`), `Memory.settle`
  (`Memory.ts:962-977`), `Chat.waits` (`Server.ts:1083-1086`).
