// Desktop Lane helper daemon.
//
// A signed, launchd-managed native helper that owns the dangerous macOS surface
// (Accessibility, CGEvent, ScreenCaptureKit, NSWorkspace, AppleScript) behind a
// loopback HTTP API. HiveMatrix speaks the structured Desktop Lane action contract
// (src/lib/desktopbee/actions.ts) to it; nothing sensitive flows through prompts.
//
// This is the v1 skeleton: loopback HTTP server + the read-only surface
// (health, desktop.apps.list). Act/AX/capture/script actions are declared and
// stubbed; they require Accessibility + Screen Recording permission at runtime
// and land next, gated behind the contract's approval tiers.

import Foundation
import AppKit
import Network
import Security

let HELPER_VERSION = "0.1.0"
let DEFAULT_PORT: UInt16 = 3748  // daemon is 3747; helper is 3748

// MARK: - Action handling

func listApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.compactMap { app in
        guard app.activationPolicy == .regular else { return nil }
        return [
            "name": app.localizedName ?? "",
            "bundleId": app.bundleIdentifier ?? "",
            "pid": app.processIdentifier,
            "active": app.isActive,
        ]
    }
}

// Apps whose AppleScript may run. The HiveMatrix client also gates by
// allowlist; this is defence-in-depth at the helper boundary.
// "System Events" is intentionally NOT in the default — it can UI-script and
// synthesize input across every app, so it must be explicit opt-in via
// DESKTOPBEE_SCRIPT_ALLOWLIST.
let SCRIPT_APP_ALLOWLIST = ProcessInfo.processInfo.environment["DESKTOPBEE_SCRIPT_ALLOWLIST"]?
    .split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) } ?? ["Finder"]

func activate(_ app: String) -> Bool {
    guard let r = NSWorkspace.shared.runningApplications.first(where: {
        $0.bundleIdentifier == app || $0.localizedName == app
    }) else { return false }
    return r.activate()
}

// Server-side approval tiers (mirrors the TS contract). Free = read-only;
// everything that acts requires an explicit approved flag in the request, so
// the helper itself refuses to act/script without approval — not just the
// client. script.run is the highest tier and also gated by the app allowlist
// and the do-shell-script block.
func actionTier(_ action: String) -> String {
    switch action {
    case "desktop.apps.list", "desktop.ax.query", "desktop.capture", "desktop.permissions":
        return "free"
    case "desktop.script.run":
        return "approval"
    default:
        return "policy"
    }
}

func handleAction(_ body: [String: Any]) -> [String: Any] {
    let action = body["action"] as? String ?? ""
    let requestId = body["requestId"] as? String
    let app = body["app"] as? String
    let params = body["params"] as? [String: Any] ?? [:]
    let approved = (body["approved"] as? Bool) ?? false
    func resp(_ ok: Bool, data: Any? = nil, error: String? = nil, strategy: String? = nil, captureRef: String? = nil) -> [String: Any] {
        var r: [String: Any] = ["ok": ok, "action": action]
        if let requestId { r["requestId"] = requestId }
        if let data { r["data"] = data }
        if let error { r["error"] = error }
        if let strategy { r["strategy"] = strategy }
        if let captureRef { r["captureRef"] = captureRef }
        return r
    }

    // Server-side approval gate: act/script actions require approved == true.
    if actionTier(action) != "free" && !approved {
        return resp(false, error: "approval required for '\(action)' (tier \(actionTier(action))) — request not approved")
    }

    switch action {
    case "desktop.apps.list":
        return resp(true, data: listApps(), strategy: "ax")

    case "desktop.app.activate":
        guard let app else { return resp(false, error: "app required") }
        return activate(app) ? resp(true, data: ["activated": app], strategy: "ax")
                             : resp(false, error: "app not running: \(app)")

    case "desktop.app.launch":
        // Launch via /usr/bin/open — no Automation/Apple Events permission needed.
        // params.path opens a file (in its default app or params.app); params.app
        // opens an app by name.
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        if let path = params["path"] as? String {
            proc.arguments = (app != nil) ? ["-a", app!, path] : [path]
        } else if let app {
            proc.arguments = ["-a", app]
        } else {
            return resp(false, error: "app or params.path required")
        }
        do { try proc.run(); proc.waitUntilExit() } catch { return resp(false, error: "open failed: \(error)") }
        return proc.terminationStatus == 0
            ? resp(true, data: ["launched": app ?? params["path"] as? String ?? ""], strategy: "ax")
            : resp(false, error: "open exited \(proc.terminationStatus)")

    case "desktop.ax.query":
        guard Permissions.accessibilityTrusted(prompt: false) else {
            return resp(false, error: "Accessibility permission not granted")
        }
        guard let app else { return resp(false, error: "app required") }
        let maxDepth = (params["maxDepth"] as? Int) ?? 6
        guard let tree = AX.tree(for: app, maxDepth: maxDepth) else {
            return resp(false, error: "app not running or no AX tree: \(app)")
        }
        return resp(true, data: tree, strategy: "ax")

    case "desktop.ax.act":
        guard Permissions.accessibilityTrusted(prompt: false) else {
            return resp(false, error: "Accessibility permission not granted")
        }
        guard let app, let path = params["path"] as? String else {
            return resp(false, error: "app and params.path required")
        }
        let op = (params["op"] as? String) ?? "press"
        switch AX.act(app: app, path: path, op: op, value: params["value"] as? String) {
        case .success(let m): return resp(true, data: ["result": m], strategy: "ax")
        case .failure(let e): return resp(false, error: e, strategy: "ax")
        }

    case "desktop.type":
        guard Permissions.accessibilityTrusted(prompt: false) else {
            return resp(false, error: "Accessibility permission not granted")
        }
        guard let text = params["text"] as? String else { return resp(false, error: "params.text required") }
        switch Input.type(text) {
        case .success(let m): return resp(true, data: ["result": m], strategy: "coordinate")
        case .failure(let e): return resp(false, error: e, strategy: "coordinate")
        }

    case "desktop.click":
        guard Permissions.accessibilityTrusted(prompt: false) else {
            return resp(false, error: "Accessibility permission not granted")
        }
        guard let x = params["x"] as? Double, let y = params["y"] as? Double else {
            return resp(false, error: "params.x and params.y required")
        }
        switch Input.click(x: x, y: y, count: (params["count"] as? Int) ?? 1) {
        case .success(let m): return resp(true, data: ["result": m], strategy: "coordinate")
        case .failure(let e): return resp(false, error: e, strategy: "coordinate")
        }

    case "desktop.capture":
        switch Capture.screen(tag: (params["tag"] as? String) ?? "capture") {
        case .success(let path): return resp(true, data: ["path": path], strategy: "ax", captureRef: path)
        case .failure(let e): return resp(false, error: e)
        }

    case "desktop.script.run":
        guard let app, SCRIPT_APP_ALLOWLIST.contains(app) else {
            return resp(false, error: "app '\(app ?? "?")' not in helper script allowlist")
        }
        guard let source = params["script"] as? String else { return resp(false, error: "params.script required") }
        switch Scripting.run(source) {
        case .success(let out): return resp(true, data: ["output": out], strategy: "script")
        case .failure(let e): return resp(false, error: e, strategy: "script")
        }

    case "desktop.permissions":
        let prompt = (params["prompt"] as? Bool) ?? false
        return resp(true, data: Permissions.snapshot(prompt: prompt))

    default:
        return resp(false, error: "unknown action '\(action)'")
    }
}

// MARK: - Minimal loopback HTTP/1.1 server

func jsonData(_ obj: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
}

func httpResponse(status: String, json: Data) -> Data {
    var head = "HTTP/1.1 \(status)\r\n"
    head += "Content-Type: application/json\r\n"
    head += "Content-Length: \(json.count)\r\n"
    head += "Connection: close\r\n\r\n"
    return Data(head.utf8) + json
}

// Shared-secret token gating the action API. Read from ~/.hivematrix/
// desktopbee-token (created 0600 if absent). Only the daemon, which can read
// the same file, can drive the helper — a different local process cannot.
let HELPER_TOKEN: String = {
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".hivematrix")
    let file = dir.appendingPathComponent("desktopbee-token")
    if let existing = try? String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       !existing.isEmpty {
        return existing
    }
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    let token = bytes.map { String(format: "%02x", $0) }.joined()
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try? token.write(to: file, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    return token
}()

func bearerToken(_ header: String) -> String? {
    for line in header.components(separatedBy: "\r\n") {
        let lower = line.lowercased()
        if lower.hasPrefix("authorization:") {
            let val = line.dropFirst("authorization:".count).trimmingCharacters(in: .whitespaces)
            if val.lowercased().hasPrefix("bearer ") {
                return String(val.dropFirst("bearer ".count)).trimmingCharacters(in: .whitespaces)
            }
        }
    }
    return nil
}

func handleRequest(_ raw: String) -> Data {
    // Parse the request line + (optional) JSON body after the blank line.
    let parts = raw.components(separatedBy: "\r\n\r\n")
    let header = parts.first ?? ""
    let bodyStr = parts.count > 1 ? parts[1] : ""
    let requestLine = header.components(separatedBy: "\r\n").first ?? ""
    let tokens = requestLine.components(separatedBy: " ")
    let method = tokens.first ?? "GET"
    let path = tokens.count > 1 ? tokens[1] : "/"

    if method == "GET" && path == "/health" {
        return httpResponse(status: "200 OK", json: jsonData([
            "ok": true, "service": "desktopbee-helper", "version": HELPER_VERSION,
        ]))
    }
    if method == "POST" && (path == "/" || path == "/action") {
        // Require the shared-secret token (constant-length compare).
        let provided = bearerToken(header) ?? ""
        if provided.count != HELPER_TOKEN.count || provided != HELPER_TOKEN {
            return httpResponse(status: "401 Unauthorized", json: jsonData(["ok": false, "error": "unauthorized"]))
        }
        let body = (try? JSONSerialization.jsonObject(with: Data(bodyStr.utf8))) as? [String: Any] ?? [:]
        return httpResponse(status: "200 OK", json: jsonData(handleAction(body)))
    }
    return httpResponse(status: "404 Not Found", json: jsonData(["ok": false, "error": "not found"]))
}

final class LoopbackServer {
    private let listener: NWListener
    init(port: UInt16) throws {
        let params = NWParameters.tcp
        // Loopback only — the helper never accepts off-machine connections.
        params.requiredInterfaceType = .loopback
        listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
    }
    func start() {
        listener.newConnectionHandler = { conn in
            conn.start(queue: .global())
            self.receive(conn, buffer: Data())
        }
        listener.start(queue: .global())
        FileHandle.standardError.write(Data("[desktopbee-helper] listening on 127.0.0.1:\(DEFAULT_PORT)\n".utf8))
    }
    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, _ in
            var buf = buffer
            if let data { buf.append(data) }
            let text = String(data: buf, encoding: .utf8) ?? ""
            // Wait until we have headers and (for POST) the full declared body.
            if text.contains("\r\n\r\n"), self.bodyComplete(text) {
                let response = handleRequest(text)
                conn.send(content: response, completion: .contentProcessed { _ in conn.cancel() })
            } else if isComplete {
                conn.cancel()
            } else {
                self.receive(conn, buffer: buf)
            }
        }
    }
    private func bodyComplete(_ text: String) -> Bool {
        guard let range = text.range(of: "\r\n\r\n") else { return false }
        let header = String(text[text.startIndex..<range.lowerBound])
        let body = String(text[range.upperBound...])
        if let cl = header.lowercased().components(separatedBy: "\r\n")
            .first(where: { $0.hasPrefix("content-length:") })?
            .components(separatedBy: ":").last?.trimmingCharacters(in: .whitespaces),
           let n = Int(cl) {
            return body.utf8.count >= n
        }
        return true // no body expected (GET)
    }
}

// MARK: - Entry

// CLI subcommand mode: `DesktopBeeHelper calendar today|create ...` and
// `DesktopBeeHelper reminders list|create ...` run their subcommand
// (Calendar.swift / Reminders.swift, both EventKit-backed) and exit
// directly — they must never start the HTTP daemon below. Any other
// invocation, including no args at all, preserves the existing daemon
// behavior exactly.
let cliArgs = Array(CommandLine.arguments.dropFirst())
if cliArgs.first == "calendar" {
    CalendarCLI.run(Array(cliArgs.dropFirst()))
}
if cliArgs.first == "reminders" {
    RemindersCLI.run(Array(cliArgs.dropFirst()))
}

let port = ProcessInfo.processInfo.environment["DESKTOPBEE_PORT"].flatMap { UInt16($0) } ?? DEFAULT_PORT
do {
    let server = try LoopbackServer(port: port)
    server.start()
    RunLoop.main.run()
} catch {
    FileHandle.standardError.write(Data("[desktopbee-helper] fatal: \(error)\n".utf8))
    exit(1)
}
