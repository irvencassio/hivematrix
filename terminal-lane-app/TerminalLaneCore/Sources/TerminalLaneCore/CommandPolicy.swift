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
        // sudo option flags that consume a following argument token.
        let sudoArgFlags: Set<String> = [
            "-u", "--user", "-g", "--group", "-p", "--prompt",
            "-C", "--close-from", "-r", "--role", "-t", "--type", "-U", "--other-user",
        ]
        func stripEnv() { while let f = tokens.first, isEnvAssignment(f) { tokens.removeFirst() } }

        var sawSudo = false
        stripEnv()
        while let first = tokens.first, basename(first) == "sudo" {
            sawSudo = true
            tokens.removeFirst()
            // Scan sudo's own options; sudo accepts env assignments interleaved
            // with flags, and some flags consume the next token as their value.
            scan: while let f = tokens.first {
                if isEnvAssignment(f) { tokens.removeFirst(); continue }
                if f == "--" { tokens.removeFirst(); break scan }   // end of options
                if f.hasPrefix("-") {
                    tokens.removeFirst()
                    if sudoArgFlags.contains(f), !tokens.isEmpty { tokens.removeFirst() }
                    continue
                }
                break scan   // reached the command (or a nested sudo)
            }
            stripEnv()
        }
        guard let cmd = tokens.first, !cmd.isEmpty else {
            // A sudo wrapper with no resolved command (e.g. `sudo -i`) is an
            // interactive root shell — classify it as "sudo" so read-only blocks
            // it; a genuinely blank segment stays nil (a harmless no-op).
            return sawSudo ? "sudo" : nil
        }
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
