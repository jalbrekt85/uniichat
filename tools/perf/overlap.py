#!/usr/bin/env python3
"""Compactor-overlap report for a running oMLX server.

Reads oMLX's request log and prints, for the log's window:

  * per-model request counts, output tokens, in-flight time
  * how much of the chat model's busy time overlapped compactor traffic
  * the chat model's tok/s split by output length *and* compactor overlap
  * length-matched clean/loaded pairs
  * prefix-cache re-prefill volume

Usage:  python3 tools/perf/overlap.py [log path]
Default log: ~/.omlx/logs/server.log
Main model / compactor defaults: glm-5.3-flash / qwen3-4b (env MAIN, CO).
"""

import os
import re
import statistics as st
import sys
from datetime import datetime

LOG = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.omlx/logs/server.log")
MAIN = os.environ.get("MAIN", "glm-5.3-flash")
CO = os.environ.get("CO", "qwen3-4b")

REQ = re.compile(
    r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+) - omlx\.server - \w+ - \[-\] - "
    r"Anthropic message: model=([\w.\-]+), (\d+) tokens in ([\d.]+)s \(([\d.]+) tok/s\)"
)
MTP = re.compile(
    r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+) .*MTP\[\d+\] finish=\S+ tokens=(\d+) "
    r"cycles=(\d+) tok/cycle=([\d.]+) accept=\d+/\d+ \(([\d.]+)%\).*backbone=([\d.]+)ms"
)
REPREFILL = re.compile(r"re-prefills (\d+) of (\d+) tokens")


def ts(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S,%f").timestamp()


def union(intervals):
    out = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def main():
    reqs, mtp, reprefill = [], [], []
    for line in open(LOG, errors="replace"):
        m = REQ.match(line)
        if m:
            end = ts(m.group(1))
            dur = float(m.group(4))
            reqs.append(dict(model=m.group(2), start=end - dur, end=end, dur=dur,
                             tok=int(m.group(3)), tps=float(m.group(5))))
            continue
        m = MTP.match(line)
        if m:
            mtp.append(dict(t=ts(m.group(1)), tok=int(m.group(2)), cycles=int(m.group(3)),
                            tpc=float(m.group(4)), acc=float(m.group(5)), bb=float(m.group(6)) / 1000,
                            uid=None))
            continue
        m = REPREFILL.search(line)
        if m:
            reprefill.append((int(m.group(1)), int(m.group(2))))

    if not reqs:
        print("no requests in " + LOG)
        return

    t0 = min(r["start"] for r in reqs)
    t1 = max(r["end"] for r in reqs)
    window = t1 - t0
    print(f"log window {datetime.fromtimestamp(t0):%Y-%m-%d %H:%M} - "
          f"{datetime.fromtimestamp(t1):%H:%M}  ({window / 3600:.2f} h), {len(reqs)} requests\n")

    # -- per model ---------------------------------------------------------
    print(f"{'model':18s} {'calls':>6s} {'out tok':>9s} {'in-flight':>11s} {'share':>6s}")
    for model in (MAIN, CO):
        xs = [r for r in reqs if r["model"] == model]
        busy = sum(r["dur"] for r in xs)
        print(f"{model:18s} {len(xs):6d} {sum(r['tok'] for r in xs):9d} "
              f"{busy / 3600:9.2f} h {busy / window * 100:5.0f}%")

    gu = union([(r["start"], r["end"]) for r in reqs if r["model"] == MAIN])
    cu = union([(r["start"], r["end"]) for r in reqs if r["model"] == CO])

    def total(iv):
        return sum(e - s for s, e in iv)

    both = sum(max(0, min(b, d) - max(a, c)) for a, b in gu for c, d in cu)
    print(f"\nmain model in flight   {total(gu) / 3600:.2f} h ({total(gu) / window * 100:.0f}% of window)")
    print(f"compactor in flight    {total(cu) / 3600:.2f} h ({total(cu) / window * 100:.0f}% of window)")
    if total(gu):
        print(f"both in flight         {both / 3600:.2f} h = {both / total(gu) * 100:.0f}% of the main "
              f"model's busy time, {both / max(total(cu), 1e-9) * 100:.0f}% of the compactor's")
    n_main = sum(1 for r in reqs if r["model"] == MAIN)
    n_co = sum(1 for r in reqs if r["model"] == CO)
    print(f"compactor calls per main-model call: {n_co / max(n_main, 1):.1f}")

    # -- overlap per main-model request ------------------------------------
    def overlapped(a, b):
        return sum(max(0, min(b, e) - max(a, s)) for s, e in cu)

    mains = [r for r in reqs if r["model"] == MAIN]
    for r in mains:
        r["ovl"] = overlapped(r["start"], r["end"]) / max(r["dur"], 1e-9)

    print("\nmain-model tok/s by output length and compactor overlap (medians):")
    for lo, hi in ((2000, 6000), (6000, 12000), (12000, 10 ** 9)):
        row = []
        for label, keep in (("low <30%", lambda r: r["ovl"] < 0.3),
                            ("high >=50%", lambda r: r["ovl"] >= 0.5)):
            sel = [r for r in mains if lo <= r["tok"] < hi and keep(r)]
            if len(sel) >= 2:
                row.append(f"{label} n={len(sel):3d} {st.median(r['tps'] for r in sel):5.1f} tok/s")
            else:
                row.append(f"{label} n={len(sel):3d}    —")
        hi_s = "      " if hi >= 10 ** 9 else f"{hi:6d}"
        print(f"  out {lo:5d}-{hi_s}   " + "   |   ".join(row))

    # -- length-matched pairs ---------------------------------------------
    clean = [r for r in mains if r["ovl"] < 0.3 and r["tok"] >= 1000]
    loaded = [r for r in mains if r["ovl"] >= 0.7 and r["tok"] >= 1000]
    pairs = []
    for a in clean:
        best = min(loaded, key=lambda b: abs(b["tok"] - a["tok"]) / a["tok"], default=None)
        if best and abs(best["tok"] - a["tok"]) / a["tok"] <= 0.15:
            pairs.append((a, best))
    if pairs:
        ca = st.mean(a["tps"] for a, _ in pairs)
        cb = st.mean(b["tps"] for _, b in pairs)
        print(f"\nlength-matched pairs: {len(pairs)}  clean {ca:.1f} -> loaded {cb:.1f} tok/s "
              f"({(cb / ca - 1) * 100:+.0f}%)")

    # -- MTP / decode health ----------------------------------------------
    if mtp:
        print(f"\nMTP bursts: n={len(mtp)}  median acceptance {st.median(m['acc'] for m in mtp):.1f}%  "
              f"tokens/step {st.median(m['tpc'] for m in mtp):.2f}  "
              f"ms/step {st.median(m['bb'] / max(m['cycles'], 1) * 1000 for m in mtp):.1f}")

    # -- prefix cache ------------------------------------------------------
    if reprefill:
        tot_new = sum(a for a, b in reprefill)
        print(f"re-prefill: {len(reprefill)} events, {tot_new / 1e6:.2f}M tokens, "
              f"median {st.median(a / b * 100 for a, b in reprefill):.1f}% of each prompt rewritten")


if __name__ == "__main__":
    main()
