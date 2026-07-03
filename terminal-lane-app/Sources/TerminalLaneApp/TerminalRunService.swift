import Foundation

/// Terminal Lane execution engine — the visible-app twin of the daemon's local
/// shell engine (`src/lib/termbee/session.ts`). Each session is a long-lived
/// `/bin/bash` whose cwd/env/vars persist between commands; each command is
/// bracketed by a unique completion marker so we read its full combined output
/// and exit code back off the shared stdout stream (same protocol as
/// `contracts.ts`). The agent's `terminal_run` tool POSTs here so the operator
/// can watch commands run in the app.

struct TermRunOutcome {
    let output: String
    let exitCode: Int?      // nil when the command timed out or the write failed
    let timedOut: Bool
}

struct TermSessionSummary {
    let id: String
    let cwd: String
    let alive: Bool
    let createdAt: String
}

/// Implemented by the visible TerminalViewController so runs are shown live.
protocol TerminalDisplaySink: AnyObject {
    func showRun(command: String, output: String)
}

private final class TermSession {
    let id: String
    let cwd: String
    let createdAt: String
    let proc: Process
    let stdin: FileHandle
    let lock = NSLock()
    var buffer = ""
    var alive = true
    var busy = false

    init(id: String, cwd: String, proc: Process, stdin: FileHandle, createdAt: String) {
        self.id = id
        self.cwd = cwd
        self.proc = proc
        self.stdin = stdin
        self.createdAt = createdAt
    }

    func append(_ text: String) {
        lock.lock(); buffer += text; lock.unlock()
    }

    func snapshot() -> String {
        lock.lock(); defer { lock.unlock() }; return buffer
    }
}

final class TerminalRunService {
    static let shared = TerminalRunService()
    weak var display: TerminalDisplaySink?

    private var sessions: [String: TermSession] = [:]
    private let registryLock = NSLock()
    private let workQueue = DispatchQueue(label: "hivematrix.terminal.run", attributes: .concurrent)

    private static let defaultTimeout: TimeInterval = 120

    // MARK: Sessions

    @discardableResult
    func createSession(id explicitId: String?, cwd: String?) -> String {
        let id = explicitId ?? "term_\(UUID().uuidString.prefix(10).lowercased())"
        registryLock.lock()
        if let existing = sessions[id], existing.alive {
            registryLock.unlock()
            return id
        }
        registryLock.unlock()

        let dir = cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = ["--norc", "--noprofile"]
        proc.currentDirectoryURL = URL(fileURLWithPath: dir)
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        proc.standardInput = stdinPipe
        proc.standardOutput = stdoutPipe
        proc.standardError = stderrPipe

        let createdAt = ISO8601DateFormatter().string(from: Date())
        let session = TermSession(id: id, cwd: dir, proc: proc, stdin: stdinPipe.fileHandleForWriting, createdAt: createdAt)

        let onData: (FileHandle) -> Void = { [weak session] handle in
            let data = handle.availableData
            guard !data.isEmpty, let session else { return }
            session.append(String(decoding: data, as: UTF8.self))
        }
        stdoutPipe.fileHandleForReading.readabilityHandler = onData
        stderrPipe.fileHandleForReading.readabilityHandler = onData
        proc.terminationHandler = { [weak session] _ in session?.alive = false }

        do {
            try proc.run()
        } catch {
            NSLog("TerminalRunService: failed to start session \(id): \(error)")
        }

        registryLock.lock(); sessions[id] = session; registryLock.unlock()
        return id
    }

    func listSessions() -> [TermSessionSummary] {
        registryLock.lock(); defer { registryLock.unlock() }
        return sessions.values.map { TermSessionSummary(id: $0.id, cwd: $0.cwd, alive: $0.alive, createdAt: $0.createdAt) }
    }

    @discardableResult
    func killSession(id: String) -> Bool {
        registryLock.lock()
        let session = sessions.removeValue(forKey: id)
        registryLock.unlock()
        guard let session else { return false }
        session.proc.terminationHandler = nil
        session.proc.terminate()
        return true
    }

    // MARK: Run

    func run(sessionId: String, command: String, timeoutMs: Int?, completion: @escaping (TermRunOutcome) -> Void) {
        registryLock.lock()
        var session = sessions[sessionId]
        registryLock.unlock()
        if session == nil {
            createSession(id: sessionId, cwd: nil)
            registryLock.lock(); session = sessions[sessionId]; registryLock.unlock()
        }
        guard let session else {
            completion(TermRunOutcome(output: "(could not create session)", exitCode: nil, timedOut: false))
            return
        }
        if !session.alive {
            completion(TermRunOutcome(output: "(session is dead)", exitCode: nil, timedOut: false))
            return
        }
        if session.busy {
            completion(TermRunOutcome(output: "(session busy with another command)", exitCode: nil, timedOut: false))
            return
        }
        session.busy = true

        let nonce = String(UUID().uuidString.prefix(8))
        let marker = "__TERMBEE_DONE_\(nonce)__"
        let startLen = session.snapshot().count
        let payload = "{\n\(command)\n} 2>&1\necho \"\(marker):$?\"\n"
        let timeout = TimeInterval(timeoutMs.map { Double($0) / 1000.0 } ?? Self.defaultTimeout)

        do {
            try session.stdin.write(contentsOf: Data(payload.utf8))
        } catch {
            session.busy = false
            completion(TermRunOutcome(output: "(write failed: \(error.localizedDescription))", exitCode: nil, timedOut: false))
            return
        }

        workQueue.async { [weak self] in
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                let whole = session.snapshot()
                let since = String(whole.dropFirst(startLen))
                if let result = Self.extractResult(since, marker: marker) {
                    session.busy = false
                    let trimmed = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
                    self?.emitDisplay(command: command, output: trimmed)
                    completion(TermRunOutcome(output: trimmed, exitCode: result.exitCode, timedOut: false))
                    return
                }
                Thread.sleep(forTimeInterval: 0.05)
            }
            session.busy = false
            let whole = session.snapshot()
            let since = String(whole.dropFirst(startLen)).trimmingCharacters(in: .whitespacesAndNewlines)
            self?.emitDisplay(command: command, output: since)
            completion(TermRunOutcome(output: since, exitCode: nil, timedOut: true))
        }
    }

    private func emitDisplay(command: String, output: String) {
        DispatchQueue.main.async {
            self.display?.showRun(command: command, output: output)
        }
    }

    /// Mirror of `extractResult` in contracts.ts.
    private static func extractResult(_ buffer: String, marker: String) -> (output: String, exitCode: Int)? {
        guard let markerRange = buffer.range(of: marker + ":") else { return nil }
        let afterMarker = buffer[markerRange.upperBound...]
        // Read the exit-code digits (optionally negative) right after "marker:".
        var digits = ""
        for ch in afterMarker {
            if ch == "-" && digits.isEmpty { digits.append(ch); continue }
            if ch.isNumber { digits.append(ch); continue }
            break
        }
        guard let code = Int(digits) else { return nil }
        let output = String(buffer[buffer.startIndex..<markerRange.lowerBound])
        return (output, code)
    }
}
