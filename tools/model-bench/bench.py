#!/usr/bin/env python3
"""
Head-to-head coding/agentic benchmark for local OpenAI-compatible models.

Probes the failure modes that matter for HiveMatrix agents:
  T1 stdlib API recall (curses)      — the curses.nap vs napms bug class
  T2 spec-following + correctness    — TTL+LRU cache scored by pytest
  T3 cross-language (Node built-ins) — runnable script, verified output
  T4 agentic tool calling            — two-step tool chain with real schemas
  T5 bug fixing from a traceback     — the HiveMatrix repair loop
  T6 API precision (datetime/tz)     — scored by asserts

Usage:
  python3 bench.py --endpoint http://127.0.0.1:8000/v1 --model deepseek-v4-flash \
      --label ds4-q2 [--runs 2] [--effort medium] [--only T1,T4]
Results land in results/<label>.json; use report.py to compare labels.
"""

import argparse, json, os, re, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
RAW = os.path.join(HERE, "raw")
CODE_FENCE = re.compile(r"```(?:python|py|javascript|js|node)?\s*\n(.*?)```", re.DOTALL)


def chat(endpoint, model, messages, effort, seed, tools=None, timeout=900):
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "seed": seed,
        "max_tokens": 16384,
    }
    if effort:
        body["reasoning_effort"] = effort
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    elapsed = time.monotonic() - t0
    msg = data["choices"][0]["message"]
    usage = data.get("usage", {})
    return msg, usage, elapsed


def last_code_block(text):
    blocks = CODE_FENCE.findall(text or "")
    if blocks:
        return max(blocks, key=len)  # biggest block = the program, not snippets
    # model may have emitted bare code with no fence
    return (text or "").strip()


def run_cmd(argv, cwd=None, timeout=60, env=None):
    try:
        p = subprocess.run(argv, cwd=cwd, timeout=timeout, capture_output=True, text=True, env=env)
        return p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        return -9, "TIMEOUT"


def mypy_hallucination_errors(path):
    rc, out = run_cmd([sys.executable, "-m", "mypy", "--ignore-missing-imports",
                       "--no-error-summary", path], timeout=120)
    bad = [l for l in out.splitlines() if "attr-defined" in l or "name-defined" in l]
    return bad, out


# ── task verifiers ─────────────────────────────────────────────────────────

def verify_python_static(code, forbidden=(), required=()):
    notes = []
    score = 1.0
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "prog.py")
        open(p, "w").write(code)
        rc, out = run_cmd([sys.executable, "-m", "py_compile", p])
        if rc != 0:
            return 0.0, ["does not compile: " + out[:300]]
        bad, _ = mypy_hallucination_errors(p)
        if bad:
            score -= 0.5
            notes += ["mypy hallucinated-API errors: " + "; ".join(b.split("error:")[-1].strip() for b in bad[:3])]
        for pat in forbidden:
            if re.search(pat, code):
                score -= 0.5
                notes.append(f"forbidden pattern present: {pat}")
        for pat in required:
            if not re.search(pat, code):
                score -= 0.25
                notes.append(f"missing expected pattern: {pat}")
    return max(score, 0.0), notes


def verify_ttlcache(code):
    tests = '''
import time as _time
import pytest
from prog import TTLCache

def test_basic_put_get():
    c = TTLCache(2, 100)
    c.put("a", 1); c.put("b", 2)
    assert c.get("a") == 1 and c.get("b") == 2

def test_lru_eviction():
    c = TTLCache(2, 100)
    c.put("a", 1); c.put("b", 2)
    assert c.get("a") == 1          # a is now most-recent
    c.put("c", 3)                    # evicts b
    assert c.get("b") is None
    assert c.get("a") == 1 and c.get("c") == 3

def test_ttl_expiry(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(_time, "monotonic", lambda: now[0])
    c = TTLCache(4, ttl_seconds=10)
    c.put("a", 1)
    now[0] += 5
    assert c.get("a") == 1
    now[0] += 6
    assert c.get("a") is None
'''
    with tempfile.TemporaryDirectory() as td:
        open(os.path.join(td, "prog.py"), "w").write(code)
        open(os.path.join(td, "test_prog.py"), "w").write(tests)
        rc, out = run_cmd([sys.executable, "-m", "pytest", "-x", "-q", "test_prog.py"], cwd=td, timeout=120)
        if rc == 0:
            return 1.0, []
        passed = out.count(" passed") and re.search(r"(\d+) passed", out)
        n = int(passed.group(1)) if passed else 0
        return round(n / 3 * 0.75, 2), ["pytest: " + out.strip().splitlines()[-1][:200] if out.strip() else "pytest failed"]


def verify_node_dupes(code):
    with tempfile.TemporaryDirectory() as td:
        prog = os.path.join(td, "dupes.js")
        open(prog, "w").write(code)
        rc, out = run_cmd(["node", "--check", prog])
        if rc != 0:
            return 0.0, ["syntax error: " + out[:200]]
        fx = os.path.join(td, "fx"); os.makedirs(fx)
        open(os.path.join(fx, "one.txt"), "w").write("SAME CONTENT\n")
        open(os.path.join(fx, "two.txt"), "w").write("SAME CONTENT\n")
        open(os.path.join(fx, "three.txt"), "w").write("different\n")
        rc, out = run_cmd(["node", prog, fx], timeout=60)
        if rc != 0:
            return 0.25, ["runs failed: " + out[:200]]
        if "one.txt" in out and "two.txt" in out and "three.txt" not in out:
            return 1.0, []
        return 0.5, ["ran but grouping wrong: " + out[:200]]


def verify_bugfix(code):
    # any working delay is a valid fix: curses.napms OR time.sleep
    score, notes = verify_python_static(code, forbidden=[r"curses\.nap\("],
                                        required=[r"curses\.napms\(|time\.sleep\("])
    return score, notes


def verify_datetime(code):
    driver = '''
from prog import parse_logline
from datetime import datetime, timezone, timedelta
dt, level, msg = parse_logline("2026-07-04T10:30:00+02:00 ERROR disk almost full")
assert level == "ERROR" and msg == "disk almost full"
assert dt.tzinfo is not None
assert dt.utcoffset() == timedelta(hours=2)
assert dt.astimezone(timezone.utc).hour == 8
print("OK")
'''
    with tempfile.TemporaryDirectory() as td:
        open(os.path.join(td, "prog.py"), "w").write(code)
        open(os.path.join(td, "drv.py"), "w").write(driver)
        rc, out = run_cmd([sys.executable, "drv.py"], cwd=td, timeout=30)
        return (1.0, []) if rc == 0 and "OK" in out else (0.0, [out.strip()[:200]])


# ── T4: two-step tool chain ────────────────────────────────────────────────

TOOLS = [
    {"type": "function", "function": {
        "name": "get_file_size",
        "description": "Return the size of a file in bytes",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "append_log",
        "description": "Append a line to the task log",
        "parameters": {"type": "object", "properties": {"message": {"type": "string"}}, "required": ["message"]}}},
]

def run_toolcall_task(endpoint, model, effort, seed):
    msgs = [
        {"role": "system", "content": "You are an agent. Use the provided tools to complete the task. Do not answer from memory."},
        {"role": "user", "content": "Find out how big /tmp/report.txt is, then append a log line exactly of the form 'size: <N> bytes' where <N> is the size you found."},
    ]
    notes, score = [], 0.0
    msg, usage, el = chat(endpoint, model, msgs, effort, seed, tools=TOOLS)
    tcs = msg.get("tool_calls") or []
    if not tcs:
        return 0.0, ["no tool call made; content: " + str(msg.get("content"))[:150]], usage, el
    tc = tcs[0]
    try:
        args = json.loads(tc["function"]["arguments"])
    except Exception:
        return 0.0, ["unparseable tool args: " + str(tc["function"].get("arguments"))[:100]], usage, el
    if tc["function"]["name"] != "get_file_size" or "report.txt" not in str(args.get("path", "")):
        return 0.25, [f"wrong first call: {tc['function']['name']}({args})"], usage, el
    score = 0.5
    msgs.append({"role": "assistant", "content": msg.get("content"), "tool_calls": tcs})
    msgs.append({"role": "tool", "tool_call_id": tc.get("id", "call_1"), "content": "31337"})
    msg2, usage2, el2 = chat(endpoint, model, msgs, effort, seed, tools=TOOLS)
    el += el2
    for k, v in (usage2 or {}).items():
        if isinstance(v, (int, float)) and isinstance(usage.get(k, 0), (int, float)):
            usage[k] = usage.get(k, 0) + v
    tcs2 = msg2.get("tool_calls") or []
    if not tcs2:
        return score, ["no second tool call; content: " + str(msg2.get("content"))[:150]], usage, el
    tc2 = tcs2[0]
    try:
        args2 = json.loads(tc2["function"]["arguments"])
    except Exception:
        return score, ["unparseable 2nd args"], usage, el
    if tc2["function"]["name"] == "append_log" and args2.get("message") == "size: 31337 bytes":
        return 1.0, [], usage, el
    if tc2["function"]["name"] == "append_log" and "31337" in str(args2.get("message", "")):
        return 0.75, [f"log line format off: {args2.get('message')!r}"], usage, el
    return score, [f"wrong second call: {tc2['function']['name']}({args2})"], usage, el


# ── task table ─────────────────────────────────────────────────────────────

TASKS = {
    "T1-curses-recall": {
        "prompt": "Using only the Python standard library curses module, write a complete program that shows a ball bouncing around the terminal at roughly 30 FPS until the user presses q. Reply with only the code in a single ```python code block.",
        "verify": lambda c: verify_python_static(c, forbidden=[r"curses\.nap\("], required=[r"curses"]),
    },
    "T2-ttlcache-pytest": {
        "prompt": "Implement in Python (standard library only) a class `TTLCache(capacity: int, ttl_seconds: float)` with methods `put(key, value)` and `get(key)`. Semantics: LRU eviction when over capacity (get refreshes recency), and entries expire ttl_seconds after they were put, measured with time.monotonic(). `get` returns None for missing or expired entries. Reply with only the code in a single ```python code block.",
        "verify": verify_ttlcache,
    },
    "T3-node-dupes": {
        "prompt": "Write a Node.js script using ONLY built-in modules (fs/promises, path, crypto) that takes a directory path as its first CLI argument, hashes every regular file directly inside it with SHA-256, and prints each group of duplicate files as a line of comma-separated filenames (only groups with 2+ files). Reply with only the code in a single ```javascript code block.",
        "verify": verify_node_dupes,
    },
    "T4-toolchain": {"special": "toolcall"},
    "T5-bugfix-traceback": {
        "prompt": '''This Python curses program crashes:

```python
import curses
def main(stdscr):
    stdscr.nodelay(1)
    while True:
        ch = stdscr.getch()
        if ch == ord('q'):
            return
        stdscr.addstr(0, 0, "running")
        stdscr.refresh()
        curses.nap(100)
curses.wrapper(main)
```

Traceback:
```
AttributeError: module 'curses' has no attribute 'nap'
```

Fix the bug. Reply with only the corrected code in a single ```python code block.''',
        "verify": verify_bugfix,
    },
    "T6-datetime-precision": {
        "prompt": "Write a Python function `parse_logline(line: str)` (standard library only) for lines like '2026-07-04T10:30:00+02:00 ERROR disk almost full'. It must return a tuple (timestamp, level, message) where timestamp is a timezone-AWARE datetime, level is the single word after the timestamp, and message is the rest. Reply with only the code in a single ```python code block.",
        "verify": verify_datetime,
    },
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    os.makedirs(RESULTS, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    # merge into an existing results file so --only reruns update single tasks
    path = os.path.join(RESULTS, f"{args.label}.json")
    if os.path.exists(path):
        out = json.load(open(path))
    else:
        out = {"label": args.label, "model": args.model, "endpoint": args.endpoint,
               "effort": args.effort, "tasks": {}, "started": time.strftime("%F %T")}

    for tid, task in TASKS.items():
        if only and tid not in only and tid.split("-")[0] not in only:
            continue
        runs = []
        for seed in range(1, args.runs + 1):
            print(f"[{args.label}] {tid} run {seed} ...", flush=True)
            try:
                if task.get("special") == "toolcall":
                    score, notes, usage, elapsed = run_toolcall_task(args.endpoint, args.model, args.effort, seed)
                    raw_text = ""
                else:
                    msg, usage, elapsed = chat(args.endpoint, args.model,
                                               [{"role": "user", "content": task["prompt"]}],
                                               args.effort, seed)
                    raw_text = msg.get("content") or ""
                    code = last_code_block(raw_text)
                    score, notes = task["verify"](code)
                ct = usage.get("completion_tokens") or 0
                runs.append({"seed": seed, "score": score, "notes": notes, "elapsed_s": round(elapsed, 1),
                             "completion_tokens": ct,
                             "tok_per_s": round(ct / elapsed, 1) if ct and elapsed else None})
                fn = os.path.join(RAW, f"{args.label}-{tid}-r{seed}.txt")
                open(fn, "w").write(raw_text)
                print(f"    score={score} elapsed={elapsed:.0f}s {'; '.join(notes)[:150]}", flush=True)
            except Exception as e:
                runs.append({"seed": seed, "score": 0.0, "notes": [f"harness/API error: {e}"], "elapsed_s": None})
                print(f"    ERROR: {e}", flush=True)
        out["tasks"][tid] = runs
        json.dump(out, open(os.path.join(RESULTS, f"{args.label}.json"), "w"), indent=2)

    total = sum(r["score"] for rs in out["tasks"].values() for r in rs)
    maxpts = sum(len(rs) for rs in out["tasks"].values())
    print(f"\n[{args.label}] TOTAL {total}/{maxpts}")

if __name__ == "__main__":
    main()
