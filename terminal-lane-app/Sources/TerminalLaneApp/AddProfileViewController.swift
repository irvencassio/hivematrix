import AppKit

final class AddProfileViewController: NSViewController {
    private let idField = NSTextField()
    private let nameField = NSTextField()
    private let authMethodPopup = NSPopUpButton()
    private let hostField = NSTextField()
    private let userField = NSTextField()
    private let portField = NSTextField()
    private let shellField = NSTextField()
    private let cwdField = NSTextField()
    private let keyPathField = NSTextField()
    private let credentialRefField = NSTextField()
    private let credentialValueField = NSSecureTextField()
    private let statusLabel = NSTextField(labelWithString: "")
    private var form: NSGridView!

    // Row indices in `form` (0-based).
    private let hostRowIndex = 3
    private let userRowIndex = 4
    private let portRowIndex = 5
    private let keyPathRowIndex = 8
    private let credentialRowIndex = 9
    private let credentialValueRowIndex = 10

    // When set (from the Profiles screen), we are editing; createdAt is preserved.
    private var editingProfile: TerminalLaneProfile?

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Add / Edit Profile")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        authMethodPopup.addItems(withTitles: TerminalLaneAuthMethod.allCases.map(\.rawValue))
        authMethodPopup.target = self
        authMethodPopup.action = #selector(authMethodChanged)
        shellField.stringValue = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = FileManager.default.homeDirectoryForCurrentUser.path
        credentialRefField.placeholderString = "hivematrix.terminal.profile.primary"
        keyPathField.placeholderString = "~/.ssh/id_ed25519"

        form = NSGridView(views: [
            [label("Profile id"), idField],
            [label("Display name"), nameField],
            [label("Auth method"), authMethodPopup],
            [label("Host"), hostField],
            [label("User"), userField],
            [label("Port"), portField],
            [label("Shell"), shellField],
            [label("Working dir"), cwdField],
            [label("Key file path"), keyPathField],
            [label("Credential ref"), credentialRefField],
            [label("Key vault material"), credentialValueField],
        ])
        form.column(at: 0).xPlacement = .trailing
        form.column(at: 1).width = 420

        loadEditTargetIfAny()
        authMethodChanged()

        let localDefaults = NSButton(title: "Use Local Mac defaults", target: self, action: #selector(useLocalDefaults))
        let save = NSButton(title: "Save profile", target: self, action: #selector(saveProfile))
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

    private func selectedAuthMethod() -> TerminalLaneAuthMethod {
        TerminalLaneAuthMethod(rawValue: authMethodPopup.titleOfSelectedItem ?? "local") ?? .local
    }

    private func loadEditTargetIfAny() {
        guard let id = TerminalLaneEditTarget.shared.consume(),
              let profile = TerminalLaneProfileStore.shared.load().first(where: { $0.id == id }) else {
            useLocalDefaults()
            return
        }
        editingProfile = profile
        idField.stringValue = profile.id
        idField.isEditable = false // id is the key; cannot change on edit
        nameField.stringValue = profile.displayName
        authMethodPopup.selectItem(withTitle: profile.authMethod.rawValue)
        hostField.stringValue = profile.host ?? ""
        userField.stringValue = profile.user ?? ""
        portField.stringValue = profile.port.map(String.init) ?? ""
        shellField.stringValue = profile.shell ?? ""
        cwdField.stringValue = profile.cwd ?? ""
        keyPathField.stringValue = profile.keyPath ?? ""
        credentialRefField.stringValue = profile.credentialRef ?? ""
        credentialValueField.stringValue = "" // secret values are never read back from Keychain into the form
    }

    @objc private func saveProfile() {
        do {
            let profile = try makeProfile(status: "saving")
            let credentialMaterial = credentialValueField.stringValue
            // Only password_keychain stores a Keychain secret in this MVP; the
            // secret VALUE goes to Keychain and never into the profile/daemon.
            if profile.authMethod == .password_keychain, let ref = profile.credentialRef, !credentialMaterial.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try TerminalLaneKeychain.shared.saveCredential(profileId: profile.id, credentialRef: ref, value: credentialMaterial)
            }
            try TerminalLaneProfileStore.shared.upsert(profile)
            statusLabel.textColor = .secondaryLabelColor
            statusLabel.stringValue = "Saved locally…"
            TerminalLaneDaemonClient.shared.sync(profile: profile) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let message):
                        self?.statusLabel.textColor = .systemGreen
                        self?.statusLabel.stringValue = message
                    case .failure(let error):
                        // Distinct from success: the local save stood, the sync did not.
                        self?.statusLabel.textColor = .systemRed
                        self?.statusLabel.stringValue = error.localizedDescription
                    }
                }
            }
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = error.localizedDescription
        }
    }

    @objc private func testConnection() {
        let profile: TerminalLaneProfile
        do {
            profile = try makeProfile(status: "checking")
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = error.localizedDescription
            return
        }
        TerminalLaneDaemonClient.shared.runReadiness(profileId: profile.id) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let message):
                    self?.statusLabel.textColor = .secondaryLabelColor
                    self?.statusLabel.stringValue = message
                case .failure(let error):
                    self?.statusLabel.textColor = .systemRed
                    self?.statusLabel.stringValue = error.localizedDescription
                }
            }
        }
    }

    @objc private func authMethodChanged() {
        let method = selectedAuthMethod()
        let isLocal = method == .local
        form?.row(at: hostRowIndex).isHidden = isLocal
        form?.row(at: userRowIndex).isHidden = isLocal
        form?.row(at: portRowIndex).isHidden = isLocal
        form?.row(at: keyPathRowIndex).isHidden = !method.needsKeyPath
        // Only password_keychain captures a Keychain secret in this MVP.
        let showCredential = method == .password_keychain
        form?.row(at: credentialRowIndex).isHidden = !showCredential
        form?.row(at: credentialValueRowIndex).isHidden = !showCredential

        statusLabel.textColor = .secondaryLabelColor
        switch method {
        case .local:
            statusLabel.stringValue = "Local profiles run a shell on this Mac (localhost); no key material is needed."
        case .ssh_key_agent:
            statusLabel.stringValue = "Uses your ssh-agent / default keys. Auto-connectable. No secret is stored."
        case .ssh_key_file:
            statusLabel.stringValue = "Connects with the key file at the path above (metadata only). Auto-connectable."
        case .password_keychain:
            statusLabel.stringValue = "Saved, but not auto-connectable yet — Terminal Lane can't use a stored secret to auto-connect. Use key auth, or connect manually."
        case .manual_password:
            statusLabel.stringValue = "You'll be prompted for the password when you open the terminal; nothing is stored."
        }
    }

    @objc private func useLocalDefaults() {
        let profile = TerminalLaneProfile.localDefault()
        idField.stringValue = profile.id
        idField.isEditable = true
        nameField.stringValue = profile.displayName
        authMethodPopup.selectItem(withTitle: TerminalLaneAuthMethod.local.rawValue)
        hostField.stringValue = ""
        userField.stringValue = profile.user ?? NSUserName()
        portField.stringValue = ""
        shellField.stringValue = profile.shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        keyPathField.stringValue = ""
        credentialRefField.stringValue = ""
        credentialValueField.stringValue = ""
        editingProfile = nil
        authMethodChanged()
    }

    private func makeProfile(status: String) throws -> TerminalLaneProfile {
        let rawId = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = rawId.lowercased().replacingOccurrences(of: " ", with: "-")
        let method = selectedAuthMethod()
        let host = hostField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = userField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let port = Int(portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        let shell = shellField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let keyPath = keyPathField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialRef = credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialMaterial = credentialValueField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !id.isEmpty else { throw ValidationError("Profile id is required.") }
        if method != .local {
            guard !host.isEmpty else { throw ValidationError("Enter a host for SSH profiles.") }
            guard !user.isEmpty else { throw ValidationError("Enter a user for SSH profiles.") }
        }
        if method.needsKeyPath, keyPath.isEmpty {
            throw ValidationError("Enter the key file path for an SSH key (file) profile.")
        }
        if method == .password_keychain {
            if credentialRef.isEmpty { throw ValidationError("Enter a credential ref (e.g. hivematrix.terminal.<id>) for a key-vault profile.") }
            if editingProfile == nil, credentialMaterial.isEmpty {
                throw ValidationError("Enter the key vault material to store in Keychain.")
            }
        }

        let target = "\(user)@\(host)"
        let openCommand: String
        switch method {
        case .local:
            openCommand = shell.isEmpty ? "/bin/zsh" : shell
        default:
            var parts = ["ssh"]
            if method.needsKeyPath, !keyPath.isEmpty { parts.append("-i"); parts.append(keyPath) }
            if let port { parts.append("-p"); parts.append(String(port)) }
            parts.append(target)
            openCommand = parts.joined(separator: " ")
        }

        return TerminalLaneProfile(
            id: id,
            displayName: nameField.stringValue.isEmpty ? id : nameField.stringValue,
            kind: method.kind,
            authMethod: method,
            host: method == .local ? nil : host,
            user: method == .local ? NSUserName() : user,
            port: method == .local ? nil : port,
            shell: shell.isEmpty ? nil : shell,
            cwd: cwdField.stringValue.isEmpty ? nil : cwdField.stringValue,
            keyPath: method.needsKeyPath && !keyPath.isEmpty ? keyPath : nil,
            credentialRef: method == .password_keychain && !credentialRef.isEmpty ? credentialRef : nil,
            openCommand: openCommand,
            notes: method == .local ? "Local shell on this Mac." : "",
            lastSyncStatus: status,
            // Editing preserves the original createdAt; only updatedAt advances.
            createdAt: editingProfile?.createdAt ?? TerminalLaneProfile.nowString(),
            updatedAt: TerminalLaneProfile.nowString()
        )
    }

    private func label(_ text: String) -> NSTextField {
        NSTextField(labelWithString: text)
    }

    private struct ValidationError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
