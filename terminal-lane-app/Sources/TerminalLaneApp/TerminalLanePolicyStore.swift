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
