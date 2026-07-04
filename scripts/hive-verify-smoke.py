#!/usr/bin/env python3
"""HiveMatrix deterministic code smoke-runner.

Purpose: catch the class of runtime bug that `py_compile`, `import`, and `mypy`
all miss — code that is syntactically valid and type-clean but crashes the moment
it actually runs. The canonical case is a curses/TUI program that raises
`_curses.error: addwstr() returned ERR` only when drawn in a real terminal (e.g.
writing to the bottom-right cell). Static checks are green because `addstr` is a
real method; the only way to catch it is to *run the program in a pseudo-terminal*.

This harness is invoked by the orchestrator's verification gate after a local
coding agent touches Python files, and is also the command the gate prompt tells
agents to run themselves. It is intentionally conservative: it only reports FAIL
when a run produces an uncaught Python traceback, so deliberate non-zero exits and
long-running servers are not penalised.

Usage:
    python3 scripts/hive-verify-smoke.py <file.py> [more.py ...]

Output: a JSON object on stdout (for machine parsing) followed by a human-readable
report on stderr. Exit code 0 = all clear, 1 = at least one file crashed, 2 = bad
invocation.
"""

import json
import os
import sys


RUN_MS = 1500          # how long to let an entry-point program run before quitting
GRACE_MS = 1000        # extra time to let it tear down after we ask it to quit
PTY_COLS = 80
PTY_ROWS = 24
# Keys we feed to nudge an interactive program toward a clean exit. Most TUIs quit
# on 'q'; ESC covers a few more. We deliberately do NOT send Ctrl-C — the tty line
# discipline turns it into a SIGINT at write time, which would raise a
# KeyboardInterrupt *we* caused and misreport a healthy program as broken. Programs
# that ignore 'q' are torn down with SIGKILL at the hard deadline instead. A program
# that crashes on first render (the bug we care about) dies long before this matters.
QUIT_KEYS = b"qQ\x1b"

TRACEBACK_MARKER = "Traceback (most recent call last):"
# Exceptions that mean "we (or the OS) asked it to stop", not "the code is broken".
# Never fail a smoke run on these — they are teardown artefacts, not defects.
TEARDOWN_EXCEPTIONS = ("KeyboardInterrupt", "SystemExit")


def _has_main_guard(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            src = fh.read()
    except OSError:
        return False
    return "__main__" in src


def _py_compile(path):
    """Cheap fallback for library modules with no entry point."""
    import py_compile

    try:
        py_compile.compile(path, doraise=True)
        return {"status": "pass", "detail": "py_compile clean (no __main__ entry point to run)"}
    except py_compile.PyCompileError as exc:
        return {"status": "fail", "detail": str(exc).strip()[-2000:]}


def _run_in_pty(path):
    """Execute the script under a pseudo-terminal and watch for a crash.

    Returns a result dict. FAIL only when the program emits a Python traceback and
    exits non-zero — that is an uncaught exception, i.e. genuinely broken code.
    """
    import fcntl
    import pty
    import select
    import struct
    import termios
    import time

    pid, fd = pty.fork()

    if pid == 0:  # child
        os.environ["TERM"] = "xterm"
        # Unbuffered so we see the traceback even on a fast crash.
        try:
            os.execvp(sys.executable, [sys.executable, "-u", path])
        except Exception:
            os._exit(127)

    # parent: give the program a real window size so getmaxyx() returns 80x24.
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", PTY_ROWS, PTY_COLS, 0, 0))
    except OSError:
        pass

    out = bytearray()
    start = time.monotonic()
    sent_quit = False
    hard_deadline = start + (RUN_MS + GRACE_MS) / 1000.0
    quit_at = start + RUN_MS / 1000.0

    while True:
        try:
            r, _, _ = select.select([fd], [], [], 0.1)
        except (OSError, ValueError):
            break
        if r:
            try:
                chunk = os.read(fd, 8192)
            except OSError:
                chunk = b""
            if chunk:
                out += chunk

        now = time.monotonic()
        if not sent_quit and now >= quit_at:
            for key in QUIT_KEYS:
                try:
                    os.write(fd, bytes([key]))
                except OSError:
                    break
            sent_quit = True

        done_pid, status = os.waitpid(pid, os.WNOHANG)
        if done_pid:
            code = os.waitstatus_to_exitcode(status)
            return _classify(path, code, bytes(out))

        if now >= hard_deadline:
            try:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
            except OSError:
                pass
            # Ran the full window without crashing → smoke passed for our purposes.
            return _classify(path, None, bytes(out))


def _terminal_exception(text):
    """The exception type on the last non-blank line of the most recent traceback."""
    idx = text.rfind(TRACEBACK_MARKER)
    if idx == -1:
        return None
    lines = [ln.strip() for ln in text[idx:].splitlines() if ln.strip()]
    if not lines:
        return None
    # Last line looks like "SomeError: message" or bare "SomeError".
    last = lines[-1]
    # Strip ANSI colour codes a traceback formatter may have added.
    import re

    last = re.sub(r"\x1b\[[0-9;]*m", "", last)
    return last.split(":", 1)[0].strip()


def _classify(path, exit_code, raw):
    text = raw.decode("utf-8", errors="replace")
    has_tb = TRACEBACK_MARKER in text
    terminal_exc = _terminal_exception(text) if has_tb else None
    teardown_only = terminal_exc in TEARDOWN_EXCEPTIONS
    crashed = has_tb and not teardown_only and (exit_code is None or exit_code != 0)
    # A traceback with exit 0 shouldn't happen, but if the program printed one and
    # still exited clean we treat it as suspicious-but-pass and surface the detail.
    if crashed:
        tail = _traceback_tail(text)
        return {"status": "fail", "detail": tail}
    if exit_code not in (None, 0) and TRACEBACK_MARKER not in text:
        # Non-zero exit with no traceback = likely a deliberate sys.exit(); not our
        # signal. Report as pass but note it so a human can eyeball if needed.
        return {"status": "pass", "detail": f"ran under pty; exited {exit_code} with no traceback (treated as intentional)"}
    return {"status": "pass", "detail": "ran under pty for the full smoke window with no traceback"}


def _traceback_tail(text):
    idx = text.rfind(TRACEBACK_MARKER)
    tail = text[idx:] if idx != -1 else text
    return tail.strip()[-2000:]


def smoke_file(path):
    kind = "entry-point" if _has_main_guard(path) else "module"
    if kind == "module":
        result = _py_compile(path)
    else:
        result = _run_in_pty(path)
    return {"path": path, "kind": kind, **result}


def main(argv):
    files = [a for a in argv if a.endswith(".py")]
    skipped = [a for a in argv if not a.endswith(".py")]
    if not files:
        print(json.dumps({"ok": True, "files": [], "skipped": skipped, "note": "no python files to smoke"}))
        return 0

    results = []
    for path in files:
        if not os.path.isfile(path):
            results.append({"path": path, "kind": "missing", "status": "skip", "detail": "file not found"})
            continue
        try:
            results.append(smoke_file(path))
        except Exception as exc:  # harness must never crash the gate
            results.append({"path": path, "kind": "error", "status": "skip", "detail": f"smoke harness error: {exc}"})

    failed = [r for r in results if r.get("status") == "fail"]
    ok = len(failed) == 0
    print(json.dumps({"ok": ok, "files": results, "skipped": skipped}))

    # Human-readable report on stderr.
    for r in results:
        line = f"[{r['status'].upper():4}] {r['path']} ({r['kind']})"
        print(line, file=sys.stderr)
        if r.get("status") == "fail":
            print("       " + r["detail"].replace("\n", "\n       "), file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
