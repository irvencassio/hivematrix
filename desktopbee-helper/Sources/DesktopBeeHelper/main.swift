// DesktopBee helper daemon.
//
// A signed, launchd-managed native helper that owns the dangerous macOS surface
// (Accessibility, CGEvent, ScreenCaptureKit, NSWorkspace, AppleScript) behind a
// loopback HTTP API. HiveMatrix speaks the structured DesktopBee action contract
// (src/lib/desktopbee/actions.ts) to it; nothing sensitive flows through prompts.
//
// This is the v1 skeleton: loopback HTTP server + the read-only surface
// (health, desktop.apps.list). Act/AX/capture/script actions are declared and
// stubbed; they require Accessibility + Screen Recording permission at runtime
// and land next, gated behind the contract's approval tiers.

import Foundation
import AppKit
import Network

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

func handleAction(_ body: [String: Any]) -> [String: Any] {
    let action = body["action"] as? String ?? ""
    let requestId = body["requestId"] as? String
    func resp(_ ok: Bool, data: Any? = nil, error: String? = nil, strategy: String? = nil) -> [String: Any] {
        var r: [String: Any] = ["ok": ok, "action": action]
        if let requestId { r["requestId"] = requestId }
        if let data { r["data"] = data }
        if let error { r["error"] = error }
        if let strategy { r["strategy"] = strategy }
        return r
    }

    switch action {
    case "desktop.apps.list":
        return resp(true, data: listApps(), strategy: "ax")
    case "desktop.app.activate",
         "desktop.ax.query", "desktop.ax.act",
         "desktop.type", "desktop.click",
         "desktop.capture", "desktop.script.run":
        // Declared in the contract; implemented in the next increment (needs
        // Accessibility / Screen Recording permission + AX/CGEvent/SCKit code).
        return resp(false, error: "action '\(action)' not yet implemented in helper v1")
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

let port = ProcessInfo.processInfo.environment["DESKTOPBEE_PORT"].flatMap { UInt16($0) } ?? DEFAULT_PORT
do {
    let server = try LoopbackServer(port: port)
    server.start()
    RunLoop.main.run()
} catch {
    FileHandle.standardError.write(Data("[desktopbee-helper] fatal: \(error)\n".utf8))
    exit(1)
}
