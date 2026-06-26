import Foundation

enum TerminalLaneProfileKind: String, Codable, CaseIterable {
    case local
    case ssh
}

struct TerminalLaneProfile: Codable, Equatable {
    var id: String
    var displayName: String
    var kind: TerminalLaneProfileKind
    var host: String?
    var user: String?
    var port: Int?
    var shell: String?
    var cwd: String?
    var credentialRef: String?
    var openCommand: String
    var notes: String
    var lastSyncStatus: String
    var createdAt: String
    var updatedAt: String

    static func nowString() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    static func localDefault() -> TerminalLaneProfile {
        TerminalLaneProfile(
            id: "local",
            displayName: "Local Mac",
            kind: .local,
            host: nil,
            user: NSUserName(),
            port: nil,
            shell: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh",
            cwd: FileManager.default.homeDirectoryForCurrentUser.path,
            credentialRef: nil,
            openCommand: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh",
            notes: "Local shell on this Mac.",
            lastSyncStatus: "not synced",
            createdAt: TerminalLaneProfile.nowString(),
            updatedAt: TerminalLaneProfile.nowString()
        )
    }
}

struct TerminalLaneDashboardProfile {
    let id: String
    let displayName: String
    let kind: String
    let host: String?
    let user: String?
    let credentialRef: String?
    let color: String
    let status: String
    let summary: String
    let lastRunAt: String?
}
