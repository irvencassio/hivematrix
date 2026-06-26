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

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Add Profile")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        kindPopup.addItems(withTitles: TerminalLaneProfileKind.allCases.map(\.rawValue))
        shellField.stringValue = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = FileManager.default.homeDirectoryForCurrentUser.path
        credentialRefField.placeholderString = "hivematrix.terminal.profile.primary"

        let form = NSGridView(views: [
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
        let save = NSButton(title: "Save profile + key", target: self, action: #selector(saveProfile))
        let test = NSButton(title: "Test connection", target: self, action: #selector(testConnection))
        let buttons = NSStackView(views: [save, test, statusLabel])
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
            let profile = makeProfile(status: "saving")
            if let ref = profile.credentialRef, !credentialValueField.stringValue.isEmpty {
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
        let id = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        TerminalLaneDaemonClient.shared.runReadiness(profileId: id.isEmpty ? "all" : id) { [weak self] result in
            DispatchQueue.main.async {
                self?.statusLabel.stringValue = (try? result.get()) ?? "readiness failed"
            }
        }
    }

    private func makeProfile(status: String) -> TerminalLaneProfile {
        let rawId = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = rawId.lowercased().replacingOccurrences(of: " ", with: "-")
        let kind = TerminalLaneProfileKind(rawValue: kindPopup.titleOfSelectedItem ?? "local") ?? .local
        let host = hostField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = userField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let port = Int(portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        let shell = shellField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let openCommand = kind == .ssh
            ? "ssh \(port.map { "-p \($0) " } ?? "")\(user)@\(host)"
            : (shell.isEmpty ? "/bin/zsh" : shell)
        return TerminalLaneProfile(
            id: id,
            displayName: nameField.stringValue.isEmpty ? id : nameField.stringValue,
            kind: kind,
            host: host.isEmpty ? nil : host,
            user: user.isEmpty ? nil : user,
            port: port,
            shell: shell.isEmpty ? nil : shell,
            cwd: cwdField.stringValue.isEmpty ? nil : cwdField.stringValue,
            credentialRef: credentialRefField.stringValue.isEmpty ? nil : credentialRefField.stringValue,
            openCommand: openCommand,
            notes: "",
            lastSyncStatus: status,
            createdAt: TerminalLaneProfile.nowString(),
            updatedAt: TerminalLaneProfile.nowString()
        )
    }

    private func label(_ text: String) -> NSTextField {
        NSTextField(labelWithString: text)
    }
}
