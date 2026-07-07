# Terminal Lane Command Policy & Rolling Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-server read-only/read-write access mode with an editable command allow/block policy, enforced in the app's interactive terminal, plus a self-rotating file log of every command run or blocked (timestamp, server, IP).

**Architecture:** The security-critical logic (command classifier + rolling logger) lives in a new dependency-free `TerminalLaneCore` SwiftPM package so it gets fast, real `swift test` coverage without building Citadel/SwiftTerm. The app wires it into the terminal input path (block on Enter, log every decision) and the UI (mode control, list editors, log viewer). The daemon gains an `accessMode` profile field (stored/synced only; enforcement is app-side).

**Tech Stack:** Swift 6 / SwiftPM (macOS 15 app + Foundation-only Core package), AppKit, SwiftTerm, Citadel; TypeScript daemon (better-sqlite3), Node test runner.

## Global Constraints

- Enforcement scope is the app's **interactive Terminal sessions** only (native-SSH and local-PTY). The local agent-run path (`/run`/TermBee) is out of scope.
- `accessMode` values are exactly `"readwrite"` (default) and `"readonly"`. Legacy rows/profiles default to `readwrite`.
- Log path: `~/Library/Application Support/Terminal Lane/logs/commands.log`; rotate at ~1 MB into `commands.1.log … commands.5.log`; delete beyond `commands.5.log`.
- Policy file: `~/Library/Application Support/Terminal Lane/command-policy.json`, seeded with defaults when missing.
- Log line format (tab-delimited): `<ISO-8601 UTC>\t<server>\t<ip|local>\t<mode>\t<RAN|BLOCKED>\t<command>` (command newlines/tabs collapsed to spaces).
- Classifier is basename-level, best-effort (documented limit): does not parse output redirects (`>`/`>>`), `bash -c`, `eval`, scripts, or interactive sub-shells.
- Blocklist (`readWriteBlocklist`) applies in **every** mode; allowlist (`readOnlyAllowlist`) gates only `readonly`.
- Never install the app to an Applications dir without asking (build/sign/package only).
- Daemon tests: `node --import tsx/esm --test '<glob>'`. Full suite: `npm test`. Scope gate: `node scripts/scope-wall.mjs`.

---

## File Structure

**New — `TerminalLaneCore` package (Foundation only):**
- `terminal-lane-app/TerminalLaneCore/Package.swift` — library package.
- `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandPolicy.swift` — `AccessMode`, `CommandDecision`, `CommandPolicy` (lists + defaults + load/save + `decide`).
- `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandLog.swift` — `CommandLogEntry`, `CommandLog` (append + rotation + `recentText`).
- `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandPolicyTests.swift`
- `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandLogTests.swift`

**Modified — app:**
- `terminal-lane-app/Package.swift` — depend on `TerminalLaneCore`.
- `Sources/TerminalLaneApp/TerminalLaneModels.swift` — `accessMode` field + `TerminalLaneAccessMode`.
- `Sources/TerminalLaneApp/TerminalLaneDaemonClient.swift` — send `accessMode`.
- `Sources/TerminalLaneApp/AddProfileViewController.swift` — access-mode control.
- `Sources/TerminalLaneApp/ProfilesViewController.swift` — Access column.
- `Sources/TerminalLaneApp/TerminalViewController.swift` — enforcement + logging.
- `Sources/TerminalLaneApp/SettingsViewController.swift` — list editors + View log button.
- `Sources/TerminalLaneApp/LogViewerController.swift` — **new** viewer sheet.
- `Sources/TerminalLaneApp/TerminalLanePolicyStore.swift` — **new** app-side glue (paths, shared `CommandPolicy` + `CommandLog`).

**Modified — daemon:**
- `src/lib/terminal-lane/contracts.ts` — `accessMode` on interface + normalize.
- `src/lib/terminal-lane/store.ts` — column in insert/select/rowToProfile.
- `src/lib/db/index.ts` — migration adding the column.

**Modified — tests/scripts:**
- `src/lib/terminal-lane/contracts.test.ts`, `store.test.ts` — accessMode coverage.
- `scripts/terminal-lane-core.test.mjs` — **new**, runs Core `swift test`.
- `scripts/terminal-lane-app.test.mjs` — grep-invariants for new files/UI.

---

## Task 1: Daemon `accessMode` field (contract + store + migration)

**Files:**
- Modify: `src/lib/terminal-lane/contracts.ts`
- Modify: `src/lib/terminal-lane/store.ts`
- Modify: `src/lib/db/index.ts` (append migration)
- Test: `src/lib/terminal-lane/contracts.test.ts`, `src/lib/terminal-lane/store.test.ts`

**Interfaces:**
- Produces: `TerminalProfile.accessMode: "readwrite" | "readonly"`; `normalizeTerminalProfile` defaults it to `"readwrite"` and rejects other values; `store` round-trips it.

- [ ] **Step 1: Write failing contract test**

In `src/lib/terminal-lane/contracts.test.ts`, add:

```ts
test("accessMode defaults to readwrite and validates its value", () => {
  const def = normalizeTerminalProfile({ id: "a", displayName: "A", authMethod: "ssh_key_agent", host: "h.x", user: "u" });
  assert.equal(def.accessMode, "readwrite");
  const ro = normalizeTerminalProfile({ id: "b", displayName: "B", authMethod: "password_keychain", host: "h.x", user: "u", credentialRef: "hivematrix.terminal.b", accessMode: "readonly" });
  assert.equal(ro.accessMode, "readonly");
  assert.throws(() => normalizeTerminalProfile({ id: "c", displayName: "C", authMethod: "local", accessMode: "sideways" }), /accessMode/i);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `node --import tsx/esm --test src/lib/terminal-lane/contracts.test.ts`
Expected: FAIL (`accessMode` is `undefined` / no validation).

- [ ] **Step 3: Add `accessMode` to the contract**

In `src/lib/terminal-lane/contracts.ts`, add to the `TerminalProfile` interface after `authMethod`:

```ts
  accessMode: "readwrite" | "readonly";
```

Add a validator near `validateCredentialRef`:

```ts
function normalizeAccessMode(value: unknown): "readwrite" | "readonly" {
  if (value == null || value === "") return "readwrite";
  if (value !== "readwrite" && value !== "readonly") fail("accessMode must be readwrite or readonly");
  return value;
}
```

In `normalizeTerminalProfile`, set it on the returned object (add after `authMethod,`):

```ts
    accessMode: normalizeAccessMode(record.accessMode),
```

- [ ] **Step 4: Run contract test — expect PASS**

Run: `node --import tsx/esm --test src/lib/terminal-lane/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing store round-trip test**

In `src/lib/terminal-lane/store.test.ts`, add:

```ts
test("accessMode persists through upsert and defaults to readwrite", () => {
  upsertTerminalProfile({ id: "ro", displayName: "RO", authMethod: "ssh_key_agent", host: "h.x", user: "u", accessMode: "readonly" });
  assert.equal(getTerminalProfile("ro")!.accessMode, "readonly");
  upsertTerminalProfile({ id: "rw", displayName: "RW", authMethod: "ssh_key_agent", host: "h.x", user: "u" });
  assert.equal(getTerminalProfile("rw")!.accessMode, "readwrite");
});
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `node --import tsx/esm --test src/lib/terminal-lane/store.test.ts`
Expected: FAIL (column/select missing → `accessMode` undefined or SQL error).

- [ ] **Step 7: Add the migration**

In `src/lib/db/index.ts`, append a new element to the end of the `MIGRATIONS` array (after the last `v31` vault_refs migration, before the closing `];`):

```ts
  // v32: Terminal Lane per-server access mode (readwrite default | readonly).
  // App-side enforcement classifies commands against editable allow/block lists;
  // the daemon only stores/syncs the mode.
  `ALTER TABLE terminal_profiles ADD COLUMN accessMode TEXT NOT NULL DEFAULT 'readwrite';`,
```

- [ ] **Step 8: Wire the column into the store**

In `src/lib/terminal-lane/store.ts`:

Add to `interface TerminalProfileRow` after `authMethod`:
```ts
  accessMode: "readwrite" | "readonly" | null;
```

In `rowToProfile`, add after the `authMethod:` line:
```ts
    accessMode: (row.accessMode ?? "readwrite") as "readwrite" | "readonly",
```

In `upsertTerminalProfile`, add `accessMode` to the INSERT column list and values, and to the `ON CONFLICT … DO UPDATE SET`:
- Column list: `… notes, accessMode)`
- Values placeholders: add one more `?` → `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
- UPDATE SET: add `accessMode = excluded.accessMode,` before `updatedAt = …`
- `.run(...)` args: add `profile.accessMode,` after `profile.notes,`

- [ ] **Step 9: Run store + contract tests — expect PASS**

Run: `node --import tsx/esm --test src/lib/terminal-lane/store.test.ts src/lib/terminal-lane/contracts.test.ts`
Expected: PASS.

- [ ] **Step 10: Run full terminal-lane daemon suite (no regressions)**

Run: `node --import tsx/esm --test 'src/lib/terminal-lane/*.test.ts'`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/terminal-lane/contracts.ts src/lib/terminal-lane/store.ts src/lib/db/index.ts src/lib/terminal-lane/contracts.test.ts src/lib/terminal-lane/store.test.ts
git commit -m "feat(terminal-lane): add per-server accessMode to profile contract + store"
```

---

## Task 2: `TerminalLaneCore` package + command classifier

**Files:**
- Create: `terminal-lane-app/TerminalLaneCore/Package.swift`
- Create: `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandPolicy.swift`
- Create: `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandPolicyTests.swift`

**Interfaces:**
- Produces: `enum AccessMode: String { case readwrite, readonly }`; `enum CommandDecision: Equatable { case allow; case blocked(reason: String) }`; `struct CommandPolicy` with `readOnlyAllowlist: [String]`, `readWriteBlocklist: [String]`, `static let defaults`, `static func load(from: URL) -> CommandPolicy`, `func save(to: URL) throws`, `func decide(commandLine: String, mode: AccessMode) -> CommandDecision`.

- [ ] **Step 1: Create the package manifest**

Create `terminal-lane-app/TerminalLaneCore/Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TerminalLaneCore",
    platforms: [.macOS("13.0")],
    products: [
        .library(name: "TerminalLaneCore", targets: ["TerminalLaneCore"]),
    ],
    targets: [
        .target(name: "TerminalLaneCore"),
        .testTarget(name: "TerminalLaneCoreTests", dependencies: ["TerminalLaneCore"]),
    ]
)
```

- [ ] **Step 2: Write the failing classifier tests**

Create `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandPolicyTests.swift`:

```swift
import XCTest
@testable import TerminalLaneCore

final class CommandPolicyTests: XCTestCase {
    let policy = CommandPolicy.defaults

    func testReadwriteAllowsNormalCommands() {
        XCTAssertEqual(policy.decide(commandLine: "rm -rf /tmp/x", mode: .readwrite), .allow)
        XCTAssertEqual(policy.decide(commandLine: "cat /etc/hosts", mode: .readwrite), .allow)
    }

    func testBlocklistAppliesInEveryMode() {
        if case .blocked = policy.decide(commandLine: "shutdown -h now", mode: .readwrite) {} else { XCTFail("shutdown must block in readwrite") }
        if case .blocked = policy.decide(commandLine: "sudo reboot", mode: .readonly) {} else { XCTFail("sudo reboot must block") }
        if case .blocked = policy.decide(commandLine: "/sbin/poweroff", mode: .readwrite) {} else { XCTFail("absolute-path poweroff must block") }
    }

    func testReadonlyAllowsAllowlistedOnly() {
        XCTAssertEqual(policy.decide(commandLine: "uptime", mode: .readonly), .allow)
        XCTAssertEqual(policy.decide(commandLine: "cat /var/log/syslog", mode: .readonly), .allow)
        if case .blocked = policy.decide(commandLine: "rm file", mode: .readonly) {} else { XCTFail("rm must block in readonly") }
        if case .blocked = policy.decide(commandLine: "./deploy.sh", mode: .readonly) {} else { XCTFail("unknown cmd must block in readonly") }
    }

    func testEveryChainSegmentIsChecked() {
        if case .blocked = policy.decide(commandLine: "cat x && rm y", mode: .readonly) {} else { XCTFail("write in a chain must block") }
        if case .blocked = policy.decide(commandLine: "cat x | tee y", mode: .readonly) {} else { XCTFail("tee not allowlisted → block") }
        XCTAssertEqual(policy.decide(commandLine: "cat x | grep y | wc -l", mode: .readonly), .allow)
    }

    func testEnvAssignmentPrefixStripped() {
        if case .blocked = policy.decide(commandLine: "FOO=bar rm z", mode: .readonly) {} else { XCTFail("env-prefixed rm must block") }
        XCTAssertEqual(policy.decide(commandLine: "LANG=C cat z", mode: .readonly), .allow)
    }

    func testEmptyIsAllowed() {
        XCTAssertEqual(policy.decide(commandLine: "   ", mode: .readonly), .allow)
        XCTAssertEqual(policy.decide(commandLine: "", mode: .readonly), .allow)
    }
}
```

- [ ] **Step 3: Run tests — expect FAIL (no such module)**

Run: `swift test --package-path terminal-lane-app/TerminalLaneCore`
Expected: FAIL to build (`CommandPolicy` undefined).

- [ ] **Step 4: Implement the classifier**

Create `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandPolicy.swift`:

```swift
import Foundation

public enum AccessMode: String, Codable, Sendable, CaseIterable {
    case readwrite
    case readonly
}

public enum CommandDecision: Equatable, Sendable {
    case allow
    case blocked(reason: String)
}

public struct CommandPolicy: Codable, Equatable, Sendable {
    public var readOnlyAllowlist: [String]
    public var readWriteBlocklist: [String]

    public init(readOnlyAllowlist: [String], readWriteBlocklist: [String]) {
        self.readOnlyAllowlist = readOnlyAllowlist
        self.readWriteBlocklist = readWriteBlocklist
    }

    public static let defaults = CommandPolicy(
        readOnlyAllowlist: [
            "cat", "ls", "grep", "egrep", "fgrep", "tail", "head", "less", "more",
            "df", "du", "ps", "top", "htop", "uptime", "uname", "who", "w", "id",
            "whoami", "stat", "find", "echo", "hostname", "ip", "ss", "netstat",
            "free", "date", "pwd", "env", "printenv", "wc", "cut", "sort", "uniq",
            "tr", "file", "which", "whereis", "lsblk", "lscpu", "lsof", "dmesg",
            "journalctl", "systemctl", "service", "git", "docker", "kubectl",
            "ping", "traceroute", "dig", "nslookup", "tree",
        ],
        readWriteBlocklist: ["shutdown", "reboot", "poweroff", "halt", "init", "mkfs"]
    )

    public func decide(commandLine: String, mode: AccessMode) -> CommandDecision {
        let commands = Self.leadingCommands(of: commandLine)
        if commands.isEmpty { return .allow }
        if let hit = commands.first(where: { readWriteBlocklist.contains($0) }) {
            return .blocked(reason: "\(hit) is blocked on all servers")
        }
        switch mode {
        case .readwrite:
            return .allow
        case .readonly:
            if let bad = commands.first(where: { !readOnlyAllowlist.contains($0) }) {
                return .blocked(reason: "\(bad) is not allowed on a read-only server")
            }
            return .allow
        }
    }

    // MARK: Parsing

    /// The basename of the leading command of every `;  &&  ||  |  &` segment.
    static func leadingCommands(of line: String) -> [String] {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return [] }
        var normalized = trimmed
        for sep in ["&&", "||", "|", ";", "&"] {
            normalized = normalized.replacingOccurrences(of: sep, with: "\u{1}")
        }
        return normalized.split(separator: "\u{1}").compactMap { leadingCommand(of: String($0)) }
    }

    static func leadingCommand(of segment: String) -> String? {
        var tokens = segment.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        while let first = tokens.first, isEnvAssignment(first) { tokens.removeFirst() }
        if let first = tokens.first, basename(first) == "sudo" {
            tokens.removeFirst()
            while let f = tokens.first, f.hasPrefix("-") { tokens.removeFirst() }
        }
        guard let cmd = tokens.first, !cmd.isEmpty else { return nil }
        return basename(cmd)
    }

    static func isEnvAssignment(_ token: String) -> Bool {
        guard let eq = token.firstIndex(of: "=") else { return false }
        let name = token[token.startIndex..<eq]
        if name.isEmpty { return false }
        return name.allSatisfy { $0 == "_" || $0.isLetter || $0.isNumber } && !(name.first?.isNumber ?? true)
    }

    static func basename(_ path: String) -> String {
        (path as NSString).lastPathComponent
    }

    // MARK: Persistence

    public static func load(from url: URL) -> CommandPolicy {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(CommandPolicy.self, from: data) else {
            return .defaults
        }
        return decoded
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: url, options: [.atomic])
    }
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `swift test --package-path terminal-lane-app/TerminalLaneCore`
Expected: PASS (all `CommandPolicyTests`).

- [ ] **Step 6: Add the npm-integrated Core test runner**

Create `scripts/terminal-lane-core.test.mjs`:

```mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("TerminalLaneCore swift tests pass (policy + log)", () => {
  const pkg = join(process.cwd(), "terminal-lane-app", "TerminalLaneCore");
  const r = spawnSync("swift", ["test", "--package-path", pkg], { encoding: "utf8" });
  if (r.status !== 0) {
    assert.fail(`swift test failed:\n${r.stdout}\n${r.stderr}`);
  }
});
```

- [ ] **Step 7: Run the runner — expect PASS**

Run: `node --import tsx/esm --test scripts/terminal-lane-core.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add terminal-lane-app/TerminalLaneCore scripts/terminal-lane-core.test.mjs
git commit -m "feat(terminal-lane): TerminalLaneCore package + command classifier with tests"
```

---

## Task 3: Rolling command log (in Core)

**Files:**
- Create: `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandLog.swift`
- Test: `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandLogTests.swift`

**Interfaces:**
- Produces: `struct CommandLogEntry { init(timestamp: Date, server: String, ip: String, mode: String, decision: String, command: String); func formatted() -> String }`; `final class CommandLog { init(directory: URL, maxBytes: Int = 1_000_000, maxFiles: Int = 5); func append(_ entry: CommandLogEntry); func recentText() -> String; var directory: URL }`.

- [ ] **Step 1: Write failing log tests**

Create `terminal-lane-app/TerminalLaneCore/Tests/TerminalLaneCoreTests/CommandLogTests.swift`:

```swift
import XCTest
@testable import TerminalLaneCore

final class CommandLogTests: XCTestCase {
    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tlcore-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testFormattedIsTabDelimitedSingleLine() {
        let ts = Date(timeIntervalSince1970: 1_770_000_000)
        let e = CommandLogEntry(timestamp: ts, server: "aiserver", ip: "10.80.114.11", mode: "readonly", decision: "BLOCKED", command: "rm -rf\n/tmp")
        let parts = e.formatted().components(separatedBy: "\t")
        XCTAssertEqual(parts.count, 6)
        XCTAssertEqual(parts[1], "aiserver")
        XCTAssertEqual(parts[4], "BLOCKED")
        XCTAssertFalse(parts[5].contains("\n"))
    }

    func testAppendWritesAndRecentTextReadsBack() {
        let dir = tempDir()
        let log = CommandLog(directory: dir)
        log.append(CommandLogEntry(timestamp: Date(timeIntervalSince1970: 1), server: "s", ip: "1.1.1.1", mode: "readwrite", decision: "RAN", command: "uptime"))
        XCTAssertTrue(log.recentText().contains("uptime"))
    }

    func testRotationCapsFileCount() {
        let dir = tempDir()
        let log = CommandLog(directory: dir, maxBytes: 200, maxFiles: 5)
        for i in 0..<500 {
            log.append(CommandLogEntry(timestamp: Date(timeIntervalSince1970: Double(i)), server: "s", ip: "1.1.1.1", mode: "readwrite", decision: "RAN", command: "command-number-\(i)"))
        }
        let files = try! FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix("commands") }
        // commands.log + commands.1..commands.5 at most
        XCTAssertLessThanOrEqual(files.count, 6)
        XCTAssertTrue(files.contains("commands.log"))
        XCTAssertFalse(files.contains("commands.6.log"))
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `swift test --package-path terminal-lane-app/TerminalLaneCore`
Expected: FAIL (`CommandLog`/`CommandLogEntry` undefined).

- [ ] **Step 3: Implement the logger**

Create `terminal-lane-app/TerminalLaneCore/Sources/TerminalLaneCore/CommandLog.swift`:

```swift
import Foundation

public struct CommandLogEntry: Sendable {
    public let timestamp: Date
    public let server: String
    public let ip: String
    public let mode: String
    public let decision: String
    public let command: String

    public init(timestamp: Date, server: String, ip: String, mode: String, decision: String, command: String) {
        self.timestamp = timestamp
        self.server = server
        self.ip = ip
        self.mode = mode
        self.decision = decision
        self.command = command
    }

    public func formatted() -> String {
        let ts = ISO8601DateFormatter().string(from: timestamp)
        let clean = command
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
        return [ts, server, ip, mode, decision, clean].joined(separator: "\t")
    }
}

/// Append-only rolling log. Rotation: when commands.log exceeds maxBytes it
/// becomes commands.1.log; existing commands.N.log shift up; commands.<maxFiles>
/// is dropped. Best-effort: failures are swallowed and never break a session.
public final class CommandLog {
    public let directory: URL
    private let maxBytes: Int
    private let maxFiles: Int

    public init(directory: URL, maxBytes: Int = 1_000_000, maxFiles: Int = 5) {
        self.directory = directory
        self.maxBytes = maxBytes
        self.maxFiles = maxFiles
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private var logURL: URL { directory.appendingPathComponent("commands.log") }
    private func rotatedURL(_ n: Int) -> URL { directory.appendingPathComponent("commands.\(n).log") }

    public func append(_ entry: CommandLogEntry) {
        rotateIfNeeded()
        let line = entry.formatted() + "\n"
        let data = Data(line.utf8)
        let fm = FileManager.default
        if let handle = try? FileHandle(forWritingTo: logURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else if !fm.fileExists(atPath: logURL.path) {
            try? data.write(to: logURL)
        }
    }

    func rotateIfNeeded() {
        let attrs = try? FileManager.default.attributesOfItem(atPath: logURL.path)
        let size = (attrs?[.size] as? Int) ?? 0
        guard size >= maxBytes else { return }
        let fm = FileManager.default
        try? fm.removeItem(at: rotatedURL(maxFiles))
        var i = maxFiles - 1
        while i >= 1 {
            let from = rotatedURL(i)
            if fm.fileExists(atPath: from.path) { try? fm.moveItem(at: from, to: rotatedURL(i + 1)) }
            i -= 1
        }
        try? fm.moveItem(at: logURL, to: rotatedURL(1))
    }

    /// Newest entries first: current log then commands.1..commands.maxFiles,
    /// each file's lines reversed (files store oldest→newest).
    public func recentText() -> String {
        var urls = [logURL]
        for i in 1...maxFiles { urls.append(rotatedURL(i)) }
        var lines: [String] = []
        for url in urls {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let fileLines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
            lines.append(contentsOf: fileLines.reversed())
        }
        return lines.joined(separator: "\n")
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `swift test --package-path terminal-lane-app/TerminalLaneCore`
Expected: PASS (policy + log tests).

- [ ] **Step 5: Commit**

```bash
git add terminal-lane-app/TerminalLaneCore
git commit -m "feat(terminal-lane): rolling command log in Core with rotation tests"
```

---

## Task 4: App depends on Core; policy/log glue

**Files:**
- Modify: `terminal-lane-app/Package.swift`
- Create: `terminal-lane-app/Sources/TerminalLaneApp/TerminalLanePolicyStore.swift`

**Interfaces:**
- Produces: `enum TerminalLanePaths { static var supportDir: URL; static var policyFile: URL; static var logsDir: URL }`; `final class TerminalLanePolicy { static let shared; var policy: CommandPolicy (get/set persists); let log: CommandLog }`.

- [ ] **Step 1: Add the Core dependency**

In `terminal-lane-app/Package.swift`, add to `dependencies:`:
```swift
        .package(path: "TerminalLaneCore"),
```
and to the executable target `dependencies:`:
```swift
                .product(name: "TerminalLaneCore", package: "TerminalLaneCore"),
```

- [ ] **Step 2: Create the app-side glue**

Create `terminal-lane-app/Sources/TerminalLaneApp/TerminalLanePolicyStore.swift`:

```swift
import Foundation
import TerminalLaneCore

enum TerminalLanePaths {
    static var supportDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("Terminal Lane")
    }
    static var policyFile: URL { supportDir.appendingPathComponent("command-policy.json") }
    static var logsDir: URL { supportDir.appendingPathComponent("logs") }
}

/// Process-wide command policy + audit log. The policy file is seeded with
/// defaults on first access; edits persist immediately.
final class TerminalLanePolicy {
    static let shared = TerminalLanePolicy()
    let log = CommandLog(directory: TerminalLanePaths.logsDir)
    private(set) var policy: CommandPolicy

    private init() {
        if FileManager.default.fileExists(atPath: TerminalLanePaths.policyFile.path) {
            policy = CommandPolicy.load(from: TerminalLanePaths.policyFile)
        } else {
            policy = .defaults
            try? policy.save(to: TerminalLanePaths.policyFile)
        }
    }

    func update(readOnlyAllowlist: [String], readWriteBlocklist: [String]) {
        policy = CommandPolicy(readOnlyAllowlist: readOnlyAllowlist, readWriteBlocklist: readWriteBlocklist)
        try? policy.save(to: TerminalLanePaths.policyFile)
    }
}
```

- [ ] **Step 3: Build the app to confirm linkage**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!` (Core resolves as a path dependency).

- [ ] **Step 4: Commit**

```bash
git add terminal-lane-app/Package.swift terminal-lane-app/Package.resolved terminal-lane-app/Sources/TerminalLaneApp/TerminalLanePolicyStore.swift
git commit -m "feat(terminal-lane): app links TerminalLaneCore + shared policy/log glue"
```

---

## Task 5: `accessMode` on the Swift model + sync payload

**Files:**
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/TerminalLaneModels.swift`
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/TerminalLaneDaemonClient.swift`

**Interfaces:**
- Consumes: `TerminalLaneCore.AccessMode` (Task 2).
- Produces: `TerminalLaneProfile.accessMode: TerminalLaneAccessMode` (default `.readwrite`); `TerminalLaneProfile.coreAccessMode: AccessMode`.

- [ ] **Step 1: Add the enum + field to the model**

In `TerminalLaneModels.swift`, add near the top (after imports): 
```swift
import TerminalLaneCore

enum TerminalLaneAccessMode: String, Codable, CaseIterable {
    case readwrite
    case readonly
    var label: String { self == .readonly ? "Read-only" : "Read-write" }
}
```

Add a stored property to `struct TerminalLaneProfile` (after `authMethod`):
```swift
    var accessMode: TerminalLaneAccessMode
```

Add to `CodingKeys`: append `accessMode` to the case list.

Add to the memberwise `init(...)`: add parameter `accessMode: TerminalLaneAccessMode` and `self.accessMode = accessMode`.

In `init(from decoder:)`, add a backward-compatible decode after `authMethod` is set:
```swift
        accessMode = (try? c.decode(TerminalLaneAccessMode.self, forKey: .accessMode)) ?? .readwrite
```

Add a computed bridge to Core:
```swift
    var coreAccessMode: AccessMode { accessMode == .readonly ? .readonly : .readwrite }
```

In `static func localDefault()`, pass `accessMode: .readwrite` in the initializer.

- [ ] **Step 2: Fix all other `TerminalLaneProfile(...)` initializer call sites**

Search and update every initializer call to pass `accessMode:`. Known call site: `AddProfileViewController.makeProfile` (Task 6 sets it from the control). For now, add `accessMode: .readwrite` to any other initializer call so the project compiles:

Run: `grep -rn "TerminalLaneProfile(" terminal-lane-app/Sources` — for each `id:`-style initializer that isn't `localDefault`/`makeProfile`, add `accessMode: .readwrite,`.

- [ ] **Step 3: Include accessMode in the sync payload**

In `TerminalLaneDaemonClient.swift`, in `sync(profile:)` body dictionary, add after `"authMethod": profile.authMethod.rawValue,`:
```swift
                "accessMode": profile.accessMode.rawValue,
```

- [ ] **Step 4: Build — expect success**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add terminal-lane-app/Sources/TerminalLaneApp/TerminalLaneModels.swift terminal-lane-app/Sources/TerminalLaneApp/TerminalLaneDaemonClient.swift
git commit -m "feat(terminal-lane): accessMode on Swift profile model + sync payload"
```

---

## Task 6: Access-mode control in Add/Edit + Profiles column

**Files:**
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/AddProfileViewController.swift`
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/ProfilesViewController.swift`

**Interfaces:**
- Consumes: `TerminalLaneProfile.accessMode`, `TerminalLaneUI.popUp()`, `TerminalLaneUI.row(_:_:)`.

- [ ] **Step 1: Add an access-mode popup to Add/Edit**

In `AddProfileViewController.swift`:

Add a field property:
```swift
    private let accessModePopup = TerminalLaneUI.popUp()
```

In `loadView()` after configuring `authMethodPopup`, populate it:
```swift
        accessModePopup.addItems(withTitles: TerminalLaneAccessMode.allCases.map(\.label))
```

In `rebuildForm()`, inside the `if method != .local { … Connection card … }` block, add an "Access mode" row to the Connection card rows:
```swift
                TerminalLaneUI.row("Access mode", accessModePopup),
```

In `loadEditTargetIfAny()`, after `selectAuthMethod(...)`:
```swift
        accessModePopup.selectItem(withTitle: profile.accessMode.label)
```

In `useLocalDefaults()`, reset it:
```swift
        accessModePopup.selectItem(withTitle: TerminalLaneAccessMode.readwrite.label)
```

In `makeProfile(status:)`, compute the selected mode and pass it to the initializer:
```swift
        let accessMode: TerminalLaneAccessMode = (method == .local)
            ? .readwrite
            : (TerminalLaneAccessMode.allCases.first { $0.label == accessModePopup.titleOfSelectedItem } ?? .readwrite)
```
and add `accessMode: accessMode,` to the returned `TerminalLaneProfile(...)`.

- [ ] **Step 2: Add an Access column to Profiles**

In `ProfilesViewController.swift`, in `configureColumns()` `columns` array, add after `("auth", "Auth method", 190)`:
```swift
            ("access", "Access", 110),
```

In `tableView(_:viewFor:row:)` switch, add a case:
```swift
        case "access": text = profile.accessMode.label
```

- [ ] **Step 3: Build — expect success**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add terminal-lane-app/Sources/TerminalLaneApp/AddProfileViewController.swift terminal-lane-app/Sources/TerminalLaneApp/ProfilesViewController.swift
git commit -m "feat(terminal-lane): access-mode control in Add/Edit + Profiles column"
```

---

## Task 7: Enforcement + logging in the terminal

**Files:**
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/TerminalViewController.swift`

**Interfaces:**
- Consumes: `TerminalLanePolicy.shared`, `CommandLogEntry`, `TerminalLaneProfile.coreAccessMode`.
- Produces: an input gate applied to both the native-SSH and local-PTY paths; a `PolicedLocalProcessTerminalView` subclass.

- [ ] **Step 1: Track the active profile + add a policy gate helper**

In `TerminalViewController.swift`, add a property:
```swift
    private var activeProfile: TerminalLaneProfile?
```
Set it at the top of `openSelectedProfile()`:
```swift
        activeProfile = profile
```

Add a shared gate that reads the pending line, classifies, logs, and returns whether to forward the newline. Add these methods:

```swift
    /// Returns true if the Enter should be forwarded (command allowed), false if
    /// it was blocked (caller must clear the line and not forward).
    private func gateOnEnter(pendingLine: String, terminal: TerminalView) -> Bool {
        guard let profile = activeProfile else { return true }
        let command = Self.stripPrompt(pendingLine)
        if command.isEmpty { return true }
        let decision = TerminalLanePolicy.shared.policy.decide(commandLine: command, mode: profile.coreAccessMode)
        let ip = profile.host ?? "local"
        switch decision {
        case .allow:
            logCommand(profile: profile, ip: ip, decision: "RAN", command: command)
            return true
        case .blocked(let reason):
            logCommand(profile: profile, ip: ip, decision: "BLOCKED", command: command)
            let notice = "\r\n\u{1b}[31m⛔ Blocked — '\(profile.displayName)' is \(profile.accessMode.label.lowercased()) (\(reason))\u{1b}[0m\r\n"
            terminal.feed(text: notice)
            return false
        }
    }

    private func logCommand(profile: TerminalLaneProfile, ip: String, decision: String, command: String) {
        let entry = CommandLogEntry(
            timestamp: Date(),
            server: profile.displayName,
            ip: ip,
            mode: profile.accessMode.rawValue,
            decision: decision,
            command: command
        )
        TerminalLanePolicy.shared.log.append(entry)
    }

    /// Read the current input line from the terminal buffer at the cursor row.
    private static func pendingLine(of terminal: Terminal) -> String {
        let row = terminal.buffer.y
        guard let line = terminal.getLine(row: row) else { return "" }
        return line.translateToString(trimRight: true)
    }

    /// Strip the shell prompt prefix, keeping the typed command.
    static func stripPrompt(_ line: String) -> String {
        let markers = ["❯ ", "$ ", "% ", "# ", "> "]
        for marker in markers {
            if let r = line.range(of: marker, options: .backwards) {
                return String(line[r.upperBound...]).trimmingCharacters(in: .whitespaces)
            }
        }
        return line.trimmingCharacters(in: .whitespaces)
    }
```

- [ ] **Step 2: Gate the native-SSH input path**

Replace `sendSSHInput(_:)` body so Enter is gated:

```swift
    fileprivate func sendSSHInput(_ data: ArraySlice<UInt8>) {
        guard let writer = stdinWriter, let terminal = sshTerminalView else { return }
        if data.contains(0x0D) {
            let pending = Self.pendingLine(of: terminal.getTerminal())
            if !gateOnEnter(pendingLine: pending, terminal: terminal) {
                let clear = ByteBuffer(bytes: [0x15]) // Ctrl-U clears the remote input line
                Task { try? await writer.write(clear) }
                return
            }
        }
        let buffer = ByteBuffer(bytes: Array(data))
        Task { try? await writer.write(buffer) }
    }
```

- [ ] **Step 3: Add a policed local-process terminal subclass**

At the bottom of `TerminalViewController.swift` (top-level), add:

```swift
/// LocalProcessTerminalView that runs an input gate on Enter. If the gate blocks,
/// it clears the current line (Ctrl-U to the local PTY) and does not forward Enter.
final class PolicedLocalProcessTerminalView: LocalProcessTerminalView {
    /// Return true to forward the keystrokes, false if blocked.
    var gate: ((_ data: ArraySlice<UInt8>, _ terminal: TerminalView) -> Bool)?

    override func send(source: TerminalView, data: ArraySlice<UInt8>) {
        if data.contains(0x0D), let gate, !gate(data, self) {
            super.send(source: source, data: ArraySlice([0x15])) // Ctrl-U, no newline
            return
        }
        super.send(source: source, data: data)
    }
}
```

- [ ] **Step 4: Use the subclass + wire its gate**

In `makeLocalTerminalView()`, change the type:
```swift
    private func makeLocalTerminalView() -> PolicedLocalProcessTerminalView {
        let terminal = PolicedLocalProcessTerminalView(frame: .zero)
        terminal.wantsLayer = true
        terminal.layer?.backgroundColor = NSColor.black.cgColor
        terminal.gate = { [weak self] data, term in
            guard let self else { return true }
            if !data.contains(0x0D) { return true }
            let pending = Self.pendingLine(of: term.getTerminal())
            return self.gateOnEnter(pendingLine: pending, terminal: term)
        }
        return terminal
    }
```

Change the `localTerminalView` property type to `PolicedLocalProcessTerminalView?`.

- [ ] **Step 5: Build — expect success**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add terminal-lane-app/Sources/TerminalLaneApp/TerminalViewController.swift
git commit -m "feat(terminal-lane): enforce access mode + log every command in the terminal"
```

---

## Task 8: Settings list editors + View Log viewer

**Files:**
- Modify: `terminal-lane-app/Sources/TerminalLaneApp/SettingsViewController.swift`
- Create: `terminal-lane-app/Sources/TerminalLaneApp/LogViewerController.swift`

**Interfaces:**
- Consumes: `TerminalLanePolicy.shared`, `TerminalLanePaths.logsDir`.

- [ ] **Step 1: Create the log viewer**

Create `terminal-lane-app/Sources/TerminalLaneApp/LogViewerController.swift`:

```swift
import AppKit

/// A scrollable, read-only viewer for the rolling command log (newest first).
final class LogViewerController: NSViewController {
    private let textView = NSTextView()

    override func loadView() {
        view = NSView()
        view.setFrameSize(NSSize(width: 760, height: 520))
        let title = TerminalLaneUI.largeTitle("Command Log")
        textView.isEditable = false
        textView.drawsBackground = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textContainerInset = NSSize(width: 10, height: 10)

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let refresh = TerminalLaneUI.secondaryButton("Refresh", target: self, action: #selector(reload))
        let reveal = TerminalLaneUI.secondaryButton("Reveal in Finder", target: self, action: #selector(reveal))
        let close = TerminalLaneUI.primaryButton("Done", target: self, action: #selector(done))
        let spacer = NSView(); spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [refresh, reveal, spacer, close])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [title, scroll, buttons])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        reload()
    }

    @objc private func reload() {
        let text = TerminalLanePolicy.shared.log.recentText()
        textView.string = text.isEmpty ? "No commands logged yet." : text
    }

    @objc private func reveal() {
        NSWorkspace.shared.activateFileViewerSelecting([TerminalLanePaths.logsDir])
    }

    @objc private func done() {
        presentingViewController?.dismiss(self)
    }
}
```

- [ ] **Step 2: Add list editors + View Log button to Settings**

In `SettingsViewController.swift`:

Add properties:
```swift
    private let allowlistView = NSTextView()
    private let blocklistView = NSTextView()
```

Add a helper to build a bordered text editor:
```swift
    private func listEditor(_ view: NSTextView, seed: [String]) -> NSView {
        view.string = seed.joined(separator: "\n")
        view.isEditable = true
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textContainerInset = NSSize(width: 8, height: 8)
        let scroll = NSScrollView()
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: 120).isActive = true
        return scroll
    }
```

In `loadView()`, seed and add sections + a View log button. After the existing `locationsCard` section, insert:
```swift
        let policy = TerminalLanePolicy.shared.policy
        let allowSection = section("Read-only allowlist (one command per line)", listEditor(allowlistView, seed: policy.readOnlyAllowlist))
        let blockSection = section("Blocked everywhere (one command per line)", listEditor(blocklistView, seed: policy.readWriteBlocklist))
        let viewLog = TerminalLaneUI.secondaryButton("View log", target: self, action: #selector(openLog))
```
Add `allowSection`, `blockSection` to the main `stack` views list (before `buttons`), add `viewLog` into the `buttons` stack, and constrain both sections' widths to the stack width like the other cards.

Update `saveSettings()` to also persist the lists:
```swift
        let allow = allowlistView.string.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let block = blocklistView.string.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        TerminalLanePolicy.shared.update(readOnlyAllowlist: allow, readWriteBlocklist: block)
```

Add the action:
```swift
    @objc private func openLog() {
        presentAsSheet(LogViewerController())
    }
```

- [ ] **Step 3: Build — expect success**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add terminal-lane-app/Sources/TerminalLaneApp/SettingsViewController.swift terminal-lane-app/Sources/TerminalLaneApp/LogViewerController.swift
git commit -m "feat(terminal-lane): Settings policy-list editors + in-app command log viewer"
```

---

## Task 9: Grep-invariants, full suite, package, manual verification

**Files:**
- Modify: `scripts/terminal-lane-app.test.mjs`

**Interfaces:** none (verification only).

- [ ] **Step 1: Extend the Swift grep-invariants**

In `scripts/terminal-lane-app.test.mjs`, add a new test:

```mjs
test("Terminal Lane command policy + audit log are wired", () => {
  const source = join(root, "terminal-lane-app", "Sources", "TerminalLaneApp");
  const core = join(root, "terminal-lane-app", "TerminalLaneCore", "Sources", "TerminalLaneCore");
  assert.ok(existsSync(join(core, "CommandPolicy.swift")), "CommandPolicy.swift exists");
  assert.ok(existsSync(join(core, "CommandLog.swift")), "CommandLog.swift exists");
  assert.ok(existsSync(join(source, "TerminalLanePolicyStore.swift")), "policy store exists");
  assert.ok(existsSync(join(source, "LogViewerController.swift")), "log viewer exists");

  const models = readFileSync(join(source, "TerminalLaneModels.swift"), "utf8");
  assert.match(models, /enum TerminalLaneAccessMode/);
  assert.match(models, /var accessMode/);

  const terminal = readFileSync(join(source, "TerminalViewController.swift"), "utf8");
  assert.match(terminal, /TerminalLanePolicy\.shared/);
  assert.match(terminal, /CommandLogEntry/);
  assert.match(terminal, /0x15/); // Ctrl-U line clear on block

  const daemon = readFileSync(join(source, "TerminalLaneDaemonClient.swift"), "utf8");
  assert.match(daemon, /accessMode/);

  const settings = readFileSync(join(source, "SettingsViewController.swift"), "utf8");
  assert.match(settings, /View log/);
  assert.match(settings, /readOnlyAllowlist|allowlistView/);

  const pkg = readFileSync(join(root, "terminal-lane-app", "Package.swift"), "utf8");
  assert.match(pkg, /TerminalLaneCore/);
});
```

- [ ] **Step 2: Run the app grep-invariants + Core runner**

Run: `node --import tsx/esm --test scripts/terminal-lane-app.test.mjs scripts/terminal-lane-core.test.mjs`
Expected: PASS.

- [ ] **Step 3: Scope-wall + full suite**

Run: `node scripts/scope-wall.mjs && npm test`
Expected: `0 violation(s)`; `fail 0`.

- [ ] **Step 4: Release build**

Run: `swift build -c release --package-path terminal-lane-app`
Expected: `Build complete!`

- [ ] **Step 5: Package + sign (do NOT install)**

```bash
node scripts/package-terminal-lane-app.mjs
codesign --force --sign "Developer ID Application: Irven Cassio (8B3CHTY93V)" --options runtime --timestamp --entitlements terminal-lane-app/Resources/entitlements.plist "build/terminal-lane/Terminal Lane.app"
```
Expected: packaged + signed. **Do not `ditto` into an Applications dir** — stop and ask the user before installing.

- [ ] **Step 6: Manual verification checklist (ask user to run, or run the signed build from build/)**

- Set aiserver to Read-only in Add/Edit → Save. Open a session; run `uptime` (RAN) and `rm -x` / `mkdir z` (⛔ blocked, line cleared).
- On a Read-write server, `shutdown` is still blocked (blocklist everywhere).
- Settings → View log shows newest-first entries with timestamp, server, IP, mode, decision.
- Edit the allowlist in Settings, Save, re-test a newly-allowed command.
- Confirm `~/Library/Application Support/Terminal Lane/logs/commands.log` exists and grows; force rotation later shows `commands.1.log`.

- [ ] **Step 7: Final commit**

```bash
git add scripts/terminal-lane-app.test.mjs
git commit -m "test(terminal-lane): grep-invariants for command policy + audit log"
```

---

## Self-Review Notes

- **Spec coverage:** §1 mode → Tasks 1,5,6; §2 lists → Tasks 2,4,8; §3 classifier → Task 2; §4 enforcement → Task 7; §5 log → Task 3; §6 viewer → Task 8; §8 testing → Tasks 2,3,9. ✅
- **Known-limit note:** the classifier does not parse output redirects (`>`/`>>`), `bash -c`, `eval`, or scripts — documented in the spec's §3 and surfaced in UI copy; not a regression, an accepted limit.
- **Type consistency:** `AccessMode` (Core) vs `TerminalLaneAccessMode` (app) bridged via `coreAccessMode`; `CommandDecision.blocked(reason:)` used consistently; `CommandLog.recentText()` / `CommandLogEntry.formatted()` names match between Tasks 3, 7, 8.
