import Foundation
import Network

/// A minimal, dependency-free loopback HTTP/1.1 server built on Network.framework.
///
/// Browser Lane and Terminal Lane are the ONE visible app per lane: the agent's
/// lane tools POST straight to the app the operator can watch, instead of a
/// separate headless backend. This server is the receiving end. It parses a
/// single request (request line + headers + Content-Length body), hands it to a
/// handler, writes one JSON response, and closes — no keep-alive, loopback only.
struct LaneHTTPRequest {
    let method: String
    let path: String
    let body: Data
}

final class LaneHTTPServer {
    private let portValue: UInt16
    private let handler: (LaneHTTPRequest, @escaping (Int, Data) -> Void) -> Void
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "hivematrix.lane.http")

    init(port: UInt16, handler: @escaping (LaneHTTPRequest, @escaping (Int, Data) -> Void) -> Void) {
        self.portValue = port
        self.handler = handler
    }

    func start() {
        guard let port = NWEndpoint.Port(rawValue: portValue) else { return }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        // Bind loopback only — this endpoint is agent↔app IPC, never public.
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: port)
        do {
            let listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.stateUpdateHandler = { state in
                if case let .failed(error) = state {
                    NSLog("LaneHTTPServer(\(port)) failed: \(error)")
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            NSLog("LaneHTTPServer(\(port)) could not start: \(error)")
        }
    }

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 128 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let data { buf.append(data) }
            if let req = self.parse(buf) {
                self.handler(req) { status, body in
                    self.respond(conn, status: status, body: body)
                }
                return
            }
            if error != nil || isComplete {
                self.respond(conn, status: 400, body: Data(#"{"error":"bad request"}"#.utf8))
                return
            }
            self.receive(conn, buffer: buf)
        }
    }

    /// Returns nil until a full request (headers + Content-Length bytes) has arrived.
    private func parse(_ buf: Data) -> LaneHTTPRequest? {
        guard let sep = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let headerData = buf.subdata(in: buf.startIndex..<sep.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 2 else { return nil }
        var contentLength = 0
        for line in lines.dropFirst() where line.lowercased().hasPrefix("content-length:") {
            let value = line.drop(while: { $0 != ":" }).dropFirst()
            contentLength = Int(value.trimmingCharacters(in: .whitespaces)) ?? 0
        }
        let bodyStart = sep.upperBound
        let available = buf.endIndex - bodyStart
        if available < contentLength { return nil }
        let body = contentLength > 0 ? buf.subdata(in: bodyStart..<(bodyStart + contentLength)) : Data()
        return LaneHTTPRequest(method: parts[0], path: parts[1], body: body)
    }

    private func respond(_ conn: NWConnection, status: Int, body: Data) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 400: reason = "Bad Request"
        case 404: reason = "Not Found"
        case 503: reason = "Service Unavailable"
        default: reason = "Error"
        }
        var header = "HTTP/1.1 \(status) \(reason)\r\n"
        header += "Content-Type: application/json\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Connection: close\r\n\r\n"
        var out = Data(header.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }
}
