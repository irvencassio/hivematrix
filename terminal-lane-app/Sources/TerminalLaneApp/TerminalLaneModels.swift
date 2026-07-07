import Foundation

enum TerminalLaneProfileKind: String, Codable, CaseIterable {
    case local
    case ssh
}

// Honest auth model. password_keychain is intentionally NOT auto-connectable
// yet: Terminal Lane has no native SSH runtime that can consume a stored
// password, so we never pretend a saved password auto-connects. See the
// daemon contract in src/lib/terminal-lane/contracts.ts.
enum TerminalLaneAuthMethod: String, Codable, CaseIterable {
    case local
    case ssh_key_agent
    case ssh_key_file
    case password_keychain
    case manual_password

    var label: String {
        switch self {
        case .local: return "Local shell"
        case .ssh_key_agent: return "SSH key (agent)"
        case .ssh_key_file: return "SSH key (file)"
        case .password_keychain: return "SSH password (Keychain)"
        case .manual_password: return "SSH manual login"
        }
    }

    var kind: TerminalLaneProfileKind { self == .local ? .local : .ssh }

    /// Whether HiveMatrix can connect this profile without an interactive prompt.
    /// password_keychain auto-connects via the native SSH runtime, authenticating
    /// with the password read from the macOS Keychain (Canopy-style).
    var autoConnect: Bool {
        switch self {
        case .local, .ssh_key_agent, .ssh_key_file, .password_keychain: return true
        case .manual_password: return false
        }
    }

    /// Whether connecting this profile uses the native SSH runtime (Citadel)
    /// rather than spawning /usr/bin/ssh in a local PTY.
    var usesNativeSSH: Bool { self == .password_keychain }

    var needsCredential: Bool { self == .password_keychain || self == .ssh_key_file }
    var needsKeyPath: Bool { self == .ssh_key_file }

    /// Honest, actionable reason shown when auto-connect is unavailable.
    var connectReason: String? {
        switch self {
        case .local, .ssh_key_agent, .ssh_key_file, .password_keychain: return nil
        case .manual_password:
            return "Opens an interactive session and prompts on connect; nothing is stored."
        }
    }
}

struct TerminalLaneProfile: Codable, Equatable {
    var id: String
    var displayName: String
    var kind: TerminalLaneProfileKind
    var authMethod: TerminalLaneAuthMethod
    var host: String?
    var user: String?
    var port: Int?
    var shell: String?
    var cwd: String?
    var keyPath: String?
    var credentialRef: String?
    var openCommand: String
    var notes: String
    var lastSyncStatus: String
    var createdAt: String
    var updatedAt: String

    var autoConnect: Bool { authMethod.autoConnect }
    var credentialPresent: Bool { (credentialRef?.isEmpty == false) }

    /// Canonical credentialRef marker for this profile. It signals "the password
    /// lives in the macOS Keychain" and satisfies the daemon contract; the
    /// Keychain item itself is addressed by host + user + port.
    static func derivedCredentialRef(profileId: String) -> String { "hivematrix.terminal.\(profileId)" }

    /// Keychain identity of this profile's SSH password, when it has one.
    var keychainKey: (host: String, user: String, port: Int)? {
        guard kind == .ssh, let host, !host.isEmpty, let user, !user.isEmpty else { return nil }
        return (host, user, port ?? 22)
    }

    // Backward-compatible decode: older profiles.json has no authMethod/keyPath.
    enum CodingKeys: String, CodingKey {
        case id, displayName, kind, authMethod, host, user, port, shell, cwd, keyPath, credentialRef, openCommand, notes, lastSyncStatus, createdAt, updatedAt
    }

    init(id: String, displayName: String, kind: TerminalLaneProfileKind, authMethod: TerminalLaneAuthMethod, host: String?, user: String?, port: Int?, shell: String?, cwd: String?, keyPath: String?, credentialRef: String?, openCommand: String, notes: String, lastSyncStatus: String, createdAt: String, updatedAt: String) {
        self.id = id; self.displayName = displayName; self.kind = kind; self.authMethod = authMethod
        self.host = host; self.user = user; self.port = port; self.shell = shell; self.cwd = cwd
        self.keyPath = keyPath; self.credentialRef = credentialRef; self.openCommand = openCommand
        self.notes = notes; self.lastSyncStatus = lastSyncStatus; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayName = try c.decode(String.self, forKey: .displayName)
        kind = try c.decode(TerminalLaneProfileKind.self, forKey: .kind)
        host = try c.decodeIfPresent(String.self, forKey: .host)
        user = try c.decodeIfPresent(String.self, forKey: .user)
        port = try c.decodeIfPresent(Int.self, forKey: .port)
        shell = try c.decodeIfPresent(String.self, forKey: .shell)
        cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
        keyPath = try c.decodeIfPresent(String.self, forKey: .keyPath)
        credentialRef = try c.decodeIfPresent(String.self, forKey: .credentialRef)
        openCommand = try c.decode(String.self, forKey: .openCommand)
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        lastSyncStatus = (try? c.decode(String.self, forKey: .lastSyncStatus)) ?? "not synced"
        createdAt = (try? c.decode(String.self, forKey: .createdAt)) ?? TerminalLaneProfile.nowString()
        updatedAt = (try? c.decode(String.self, forKey: .updatedAt)) ?? TerminalLaneProfile.nowString()
        // Infer authMethod for legacy rows: local→local; ssh+credentialRef→password_keychain; ssh→ssh_key_agent.
        if let decoded = try? c.decode(TerminalLaneAuthMethod.self, forKey: .authMethod) {
            authMethod = decoded
        } else {
            authMethod = kind == .local ? .local : ((credentialRef?.isEmpty == false) ? .password_keychain : .ssh_key_agent)
        }
    }

    static func nowString() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    static func localDefault() -> TerminalLaneProfile {
        TerminalLaneProfile(
            id: "local",
            displayName: "Local Mac",
            kind: .local,
            authMethod: .local,
            host: nil,
            user: NSUserName(),
            port: nil,
            shell: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh",
            cwd: FileManager.default.homeDirectoryForCurrentUser.path,
            keyPath: nil,
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

// Cross-screen edit target: Profiles → Add/Edit hands off a profile id only.
final class TerminalLaneEditTarget {
    static let shared = TerminalLaneEditTarget()
    var profileId: String?
    func consume() -> String? { defer { profileId = nil }; return profileId }
}

extension Notification.Name {
    static let terminalLaneNavigate = Notification.Name("TerminalLaneNavigate")
}
