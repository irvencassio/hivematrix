import Foundation

final class TerminalLaneSettings {
    static let shared = TerminalLaneSettings()

    private let defaults = UserDefaults.standard
    private let daemonURLKey = "terminalLane.daemonURL"

    var daemonURL: String {
        get {
            let stored = defaults.string(forKey: daemonURLKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return stored?.isEmpty == false ? stored! : "http://127.0.0.1:3747"
        }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            defaults.set(trimmed.isEmpty ? "http://127.0.0.1:3747" : trimmed, forKey: daemonURLKey)
        }
    }

    var tokenPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
            .path
    }

    var profileStorePath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("Terminal Lane")
            .appendingPathComponent("profiles.json")
            .path
    }
}
