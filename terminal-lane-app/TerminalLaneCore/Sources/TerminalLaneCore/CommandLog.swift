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
