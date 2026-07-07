# Terminal Lane — Command Policy & Rolling Audit Log

**Date:** 2026-07-07
**Status:** Approved (design)
**Surface:** Terminal Lane macOS app (interactive sessions) + daemon profile contract

## Problem

Terminal Lane runs interactive shell sessions against local and remote servers.
There is no record of what commands were run, when, or against which host, and
no way to mark a server as read-only so mutating commands are prevented. We want:

1. A self-cleaning, rolling **log file** of every command run (or blocked), with
   timestamp and the target server's IP.
2. A per-server **access mode** — read-only vs read-write — that governs which
   commands are allowed, with **editable** allow/block lists.

Scope is the **interactive Terminal sessions** (which have a server + IP). The
local agent-run path (`/run` / TermBee) is a separate surface with no server IP
and is explicitly out of scope for this iteration.

## Overview

- Each profile carries an `accessMode` (`readwrite` default, or `readonly`).
- Two global, editable command lists define policy:
  - `readOnlyAllowlist` — permitted on read-only servers.
  - `readWriteBlocklist` — blocked on **every** server, even read-write.
- A pure classifier decides `allow | block(reason)` for a command + mode.
- Enforcement happens in the app's terminal input path on Enter.
- Every decision is appended to a size-rotated log file; a Settings "View log"
  button opens an in-app viewer.

## 1. Data model: per-server access mode

New field on the terminal profile:

```
accessMode: "readwrite" | "readonly"   // default "readwrite"
```

Touch points:

- **Swift** `TerminalLaneModels.swift`: add `accessMode` to `TerminalLaneProfile`
  (Codable, backward-compatible decode → default `.readwrite` for legacy rows).
  Add an `enum TerminalLaneAccessMode: String { case readwrite, readonly }`.
- **Daemon** `contracts.ts`: add `accessMode` to `TerminalProfile`, normalize in
  `normalizeTerminalProfile` (default `readwrite`; validate the two values).
- **Daemon** `store.ts`: add `accessMode` column (migration, default
  `'readwrite'`), include in `rowToProfile` and `upsertTerminalProfile`.
- **Sync** `TerminalLaneDaemonClient.swift`: include `accessMode` in the payload.
- **UI** Add/Edit form: an "Access mode" control (Read-write / Read-only) in the
  Connection section for SSH profiles. Local profiles are always read-write and
  the control is hidden.
- **UI** Profiles table: an "Access" column showing the mode.

The daemon stores `accessMode` but does **not** enforce it (enforcement is
app-side, per §4). Local profiles are treated as read-write.

## 2. Command policy lists

Two global lists, stored app-side:

```
~/Library/Application Support/Terminal Lane/command-policy.json
{
  "readOnlyAllowlist": ["cat", "ls", "grep", ...],
  "readWriteBlocklist": ["shutdown", "reboot", "poweroff", "halt", "init", "mkfs"]
}
```

- Seeded with defaults on first run if the file is missing or unreadable.
- Edited in Settings via two multi-line editors (one command per line).
- Matched by command **basename** (case-sensitive, as shells are).

Default `readOnlyAllowlist` (informational commands):
`cat, ls, grep, egrep, fgrep, tail, head, less, more, df, du, ps, top, htop,
uptime, uname, who, w, id, whoami, stat, find, echo, hostname, ip, ss, netstat,
free, date, pwd, env, printenv, wc, cut, sort, uniq, tr, file, which, whereis,
lsblk, lscpu, lsof, dmesg, journalctl, systemctl, service, git, docker, kubectl,
ping, traceroute, dig, nslookup, tree`.

Note: some default-allowed tools can also write — `find` (`-delete`), `sed`/`awk`
(`-i` / redirection), and the subcommand tools `systemctl`/`service`/`git`/
`docker`/`kubectl` (whose read subcommands `status`/`log`/`get`/`ps` are
informational but whose write subcommands are not distinguished in this
basename-level model). They are included for convenience in read pipelines; for a
strict read-only server, remove them from the list. This is a known limit of the
basename-level model (see §3). `sed` and `awk` are deliberately **not** in the
default allowlist for this reason.

Default `readWriteBlocklist` (dangerous everywhere): `shutdown, reboot, poweroff,
halt, init, mkfs`.

## 3. Classifier

Pure function (no I/O), the single security-critical unit:

```
decide(commandLine: String, mode: AccessMode, policy: CommandPolicy) -> Decision
  Decision = .allow | .blocked(reason: String)
```

Algorithm:

1. Trim; empty/whitespace → `.allow`.
2. Split the line into segments on the shell separators `;`, `&&`, `||`, `|`, `&`.
3. For each segment, extract the leading command token:
   - strip leading `FOO=bar` environment assignments,
   - strip a leading `sudo` (and its `-flags`) and re-take the next token,
   - take the `basename` of the token (so `/sbin/reboot` → `reboot`).
4. Decision:
   - **readonly**: `.allow` iff every segment command ∈ `readOnlyAllowlist`
     AND no segment command ∈ `readWriteBlocklist`. Otherwise
     `.blocked("… is read-only")` / `.blocked("… is blocked everywhere")`.
   - **readwrite / local**: `.blocked` iff any segment command ∈
     `readWriteBlocklist`; otherwise `.allow`.

**Known limits (documented in UI + spec):** basename-level, best-effort
accident-prevention — not a security jail. A determined write via `bash -c '…'`,
`eval`, `xargs`, a script, or an interactive program (vim `:!`, etc.) can bypass
it. Subcommand-level write/read distinction is out of scope.

## 4. Enforcement

Enforcement is in the app's terminal input path, on the Enter key (CR, `0x0D`),
for both session types (native-SSH `TerminalView` and local-PTY
`LocalProcessTerminalView`):

1. On Enter, read the current input line from the terminal buffer and strip the
   prompt (reuse the Canopy-style line/prompt parse) → `commandLine`.
2. `decide(commandLine, profile.accessMode, policy)`.
3. `.allow` → forward the newline; log `RAN`.
4. `.blocked` → send Ctrl-U (`0x15`) to clear the line **instead of** the
   newline, feed a local red notice
   `⛔ Blocked — 'server' is read-only (<reason>)` into the terminal view; log
   `BLOCKED`. Nothing reaches the remote.

The pending-command read + block decision is wrapped in a small input-gate shim
so both terminal-view types share one code path.

## 5. Rolling log file

- Path: `~/Library/Application Support/Terminal Lane/logs/commands.log`.
- Line format (tab-delimited, human-readable, one per decision):
  `<ISO-8601 UTC>\t<serverDisplayName>\t<ip-or-host>\t<mode>\t<RAN|BLOCKED>\t<command>`
  - IP is the profile host (already an IP for aiserver); `local` for local
    profiles. The command is single-line (newlines in the captured line are
    collapsed to spaces).
- Rotation: when `commands.log` exceeds ~1 MB, rotate
  `commands.log → commands.1.log → … → commands.5.log`; the oldest beyond 5 is
  deleted. Total cap ≈ 5 MB. Rotation is checked on each append.
- Writes are append-only and best-effort; a logging failure never blocks or
  breaks a session (it is swallowed after a single `NSLog`).

## 6. View Log (in-app)

- A "View log" button in Settings opens a sheet/window with a scrollable,
  monospaced, read-only text view showing entries **newest first** (current log
  plus rotated files, concatenated and reversed).
- Buttons: **Refresh** (re-read files) and **Reveal in Finder** (opens the logs
  folder).

## 7. Components / files

App (`terminal-lane-app`):

- `TerminalLaneCore` — new dependency-free (Foundation-only) SwiftPM target:
  - `TerminalCommandPolicy.swift` — `AccessMode`, `CommandPolicy` (lists +
    load/save + defaults), `decide(...)`.
- `TerminalLaneApp` (executable, depends on `TerminalLaneCore`):
  - `TerminalLaneCommandLog.swift` — rolling file logger.
  - `TerminalLaneModels.swift` — `accessMode` field + enum.
  - `TerminalViewController.swift` — input gate / enforcement + logging.
  - `AddProfileViewController.swift` — access-mode control.
  - `ProfilesViewController.swift` — access column.
  - `SettingsViewController.swift` — list editors + "View log" button.
  - `LogViewerController.swift` — the viewer sheet.

Daemon (`src/lib/terminal-lane`):

- `contracts.ts`, `store.ts` — `accessMode` field + migration.

## 8. Testing

- **Swift** `TerminalLaneCoreTests` (`swift test`, fast — no Citadel/SwiftTerm):
  read/write/local modes; allowlist gate; blocklist-everywhere; multi-segment
  chains and pipelines (`a && rm b`, `cat x | tee y`); `sudo` and env-prefix
  stripping; absolute-path basenames; empty input. A
  `scripts/terminal-lane-command-policy.test.mjs` runs the Core target's
  `swift test` so it participates in `npm test` cheaply.
- **Daemon TS**: `accessMode` normalization/default in `contracts.test.ts`;
  column round-trip in `store.test.ts`.
- **Swift grep-invariants** (`scripts/terminal-lane-app.test.mjs`): new files
  exist; `accessMode` wired in model/form/table/daemon client; log rotation
  constants; "View log" button; Settings list editors.

## 9. Non-goals

- Enforcing policy on the local agent-run path (`/run` / TermBee).
- Subcommand-level classification (e.g. `git push` vs `git status`).
- Server-side enforcement or a tamper-proof audit trail.
- Per-server override of the allow/block lists (lists are global; mode is
  per-server).
