import AppKit

final class AddProfileViewController: NSViewController {
    private let idField = NSTextField()
    private let nameField = NSTextField()
    private let kindPopup = NSPopUpButton()
    private let hostField = NSTextField()
    private let userField = NSTextField()
    private let portField = NSTextField()
    private let shellField = NSTextField()
    private let cwdField = NSTextField()
    private let credentialRefField = NSTextField()
    private let credentialValueField = NSSecureTextField()
    private let statusLabel = NSTextField(labelWithString: "")
    private var form: NSGridView!
    private let hostRowIndex = 3
    private let userRowIndex = 4
    private let portRowIndex = 5
    private let credentialRowIndex = 8
    private let credentialValueRowIndex = 9

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Add Profile")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        kindPopup.addItems(withTitles: TerminalLaneProfileKind.allCases.map(\.rawValue))
        kindPopup.target = self
        kindPopup.action = #selector(kindChanged)
        useLocalDefaults()
        shellField.stringValue = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = FileManager.default.homeDirectoryForCurrentUser.path
        credentialRefField.placeholderString = "hivematrix.terminal.profile.primary"

        form = NSGridView(views: [
            [label("Profile id"), idField],
            [label("Display name"), nameField],
            [label("Kind"), kindPopup],
            [label("Host"), hostField],
            [label("User"), userField],
            [label("Port"), portField],
            [label("Shell"), shellField],
            [label("Working dir"), cwdField],
            [label("Credential ref"), credentialRefField],
            [label("Key / auth material"), credentialValueField],
        ])
        form.column(at: 0).xPlacement = .trailing
        form.column(at: 1).width = 420
        kindChanged()
        let localDefaults = NSButton(title: "Use Local Mac defaults", target: self, action: #selector(useLocalDefaults))
        let save = NSButton(title: "Save profile + key", target: self, action: #selector(saveProfile))
        let test = NSButton(title: "Test connection", target: self, action: #selector(testConnection))
        let buttons = NSStackView(views: [localDefaults, save, test, statusLabel])
        buttons.orientation = .horizontal
        buttons.spacing = 10
        let stack = NSStackView(views: [title, form, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func saveProfile() {
        do {
            let profile = try makeProfile(status: "saving")
            let credentialMaterial = credentialValueField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if profile.kind == .ssh, let ref = profile.credentialRef, !credentialMaterial.isEmpty {
                try TerminalLaneKeychain.shared.saveCredential(profileId: profile.id, credentialRef: ref, value: credentialValueField.stringValue)
            }
            try TerminalLaneProfileStore.shared.upsert(profile)
            TerminalLaneDaemonClient.shared.sync(profile: profile) { [weak self] result in
                DispatchQueue.main.async {
                    self?.statusLabel.stringValue = (try? result.get()) ?? "saved locally"
                }
            }
        } catch {
            statusLabel.stringValue = error.localizedDescription
        }
    }

    @objc private func testConnection() {
        let profile: TerminalLaneProfile
        do {
            profile = try makeProfile(status: "checking")
        } catch {
            statusLabel.stringValue = error.localizedDescription
            return
        }
        TerminalLaneDaemonClient.shared.runReadiness(profileId: profile.id) { [weak self] result in
            DispatchQueue.main.async {
                self?.statusLabel.stringValue = (try? result.get()) ?? "readiness failed"
            }
        }
    }

    @objc private func kindChanged() {
        let kind = TerminalLaneProfileKind(rawValue: kindPopup.titleOfSelectedItem ?? "local") ?? .local
        let local = kind == .local
        for index in [hostRowIndex, userRowIndex, portRowIndex, credentialRowIndex, credentialValueRowIndex] {
            form?.row(at: index).isHidden = local
        }
        statusLabel.stringValue = local
            ? "Local profiles use your current macOS session; no key material is needed."
            : "SSH profiles may store key/auth material in Keychain; the daemon receives only credentialRef."
    }

    @objc private func useLocalDefaults() {
        let profile = TerminalLaneProfile.localDefault()
        idField.stringValue = profile.id
        nameField.stringValue = profile.displayName
        kindPopup.selectItem(withTitle: profile.kind.rawValue)
        hostField.stringValue = ""
        userField.stringValue = profile.user ?? NSUserName()
        portField.stringValue = ""
        shellField.stringValue = profile.shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        credentialRefField.stringValue = ""
        credentialValueField.stringValue = ""
        kindChanged()
    }

    private func makeProfile(status: String) throws -> TerminalLaneProfile {
        let rawId = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = rawId.lowercased().replacingOccurrences(of: " ", with: "-")
        let kind = TerminalLaneProfileKind(rawValue: kindPopup.titleOfSelectedItem ?? "local") ?? .local
        let host = hostField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = userField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let port = Int(portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        let shell = shellField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialRef = credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialMaterial = credentialValueField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !id.isEmpty else { throw ValidationError("Profile id is required.") }
        if kind == .ssh {
            guard !host.isEmpty else { throw ValidationError("Enter a host for SSH profiles.") }
            guard !user.isEmpty else { throw ValidationError("Enter a user for SSH profiles.") }
            if credentialRef.isEmpty != credentialMaterial.isEmpty {
                throw ValidationError("Enter both credential ref and key/auth material, or leave both blank.")
            }
        }

        let openCommand = kind == .ssh
            ? "ssh \(port.map { "-p \($0) " } ?? "")\(user)@\(host)"
            : (shell.isEmpty ? "/bin/zsh" : shell)
        return TerminalLaneProfile(
            id: id,
            displayName: nameField.stringValue.isEmpty ? id : nameField.stringValue,
            kind: kind,
            host: kind == .local ? nil : host,
            user: kind == .local ? NSUserName() : user,
            port: kind == .local ? nil : port,
            shell: shell.isEmpty ? nil : shell,
            cwd: cwdField.stringValue.isEmpty ? nil : cwdField.stringValue,
            credentialRef: kind == .ssh && !credentialRef.isEmpty ? credentialRef : nil,
            openCommand: openCommand,
            notes: kind == .local ? "Local shell on this Mac." : "",
            lastSyncStatus: status,
            createdAt: TerminalLaneProfile.nowString(),
            updatedAt: TerminalLaneProfile.nowString()
        )
    }

    private func label(_ text: String) -> NSTextField {
        NSTextField(labelWithString: text)
    }

    private struct ValidationError: LocalizedError {
        let message: String

        init(_ message: String) {
            self.message = message
        }

        var errorDescription: String? { message }
    }
}
