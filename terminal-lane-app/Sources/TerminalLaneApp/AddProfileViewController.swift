import AppKit

final class AddProfileViewController: NSViewController, NSTextFieldDelegate {
    private let idField = NSTextField()
    private let nameField = NSTextField()
    private let authMethodPopup = NSPopUpButton()
    private let hostField = NSTextField()
    private let userField = NSTextField()
    private let portField = NSTextField()
    private let shellField = NSTextField()
    private let cwdField = NSTextField()
    private let keyPathField = NSTextField()
    private let passwordField = NSSecureTextField()
    private let keychainInfoLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private var form: NSGridView!

    // Row indices in `form` (0-based).
    private let hostRowIndex = 3
    private let userRowIndex = 4
    private let portRowIndex = 5
    private let keyPathRowIndex = 8
    private let passwordRowIndex = 9
    private let keychainInfoRowIndex = 10

    // When set (from the Profiles screen), we are editing; createdAt is preserved.
    private var editingProfile: TerminalLaneProfile?

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Add / Edit Profile")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        authMethodPopup.addItems(withTitles: TerminalLaneAuthMethod.allCases.map(\.label))
        authMethodPopup.target = self
        authMethodPopup.action = #selector(authMethodChanged)
        shellField.stringValue = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = FileManager.default.homeDirectoryForCurrentUser.path
        keyPathField.placeholderString = "~/.ssh/id_ed25519"
        passwordField.placeholderString = "Stored only in the macOS Keychain"
        keychainInfoLabel.font = .systemFont(ofSize: 11)
        keychainInfoLabel.textColor = .secondaryLabelColor
        keychainInfoLabel.lineBreakMode = .byWordWrapping
        keychainInfoLabel.preferredMaxLayoutWidth = 420
        // Keychain lookups are keyed by host + user + port, so retarget the
        // existing-password hint as those fields change.
        for field in [hostField, userField, portField] { field.delegate = self }

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
            [label("Password"), passwordField],
            [label(""), keychainInfoLabel],
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
        let index = authMethodPopup.indexOfSelectedItem
        guard index >= 0, index < TerminalLaneAuthMethod.allCases.count else { return .local }
        return TerminalLaneAuthMethod.allCases[index]
    }

    private func selectAuthMethod(_ method: TerminalLaneAuthMethod) {
        authMethodPopup.selectItem(withTitle: method.label)
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
        selectAuthMethod(profile.authMethod)
        hostField.stringValue = profile.host ?? ""
        userField.stringValue = profile.user ?? ""
        portField.stringValue = profile.port.map(String.init) ?? ""
        shellField.stringValue = profile.shell ?? ""
        cwdField.stringValue = profile.cwd ?? ""
        keyPathField.stringValue = profile.keyPath ?? ""
        passwordField.stringValue = "" // secret values are never read back from Keychain into the form
    }

    // The Keychain item is keyed by host + user + port (Internet Password) —
    // shared with other SSH tools on this Mac, so an item saved by one of them
    // is found and reused here.
    private func existingKeychainPassword() -> Bool {
        let host = hostField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = userField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty, !user.isEmpty else { return false }
        let port = Int(portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 22
        return TerminalLaneKeychain.shared.hasPassword(host: host, user: user, port: port)
    }

    private func updateKeychainInfo() {
        guard selectedAuthMethod() == .password_keychain else { return }
        let host = hostField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = userField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty, !user.isEmpty else {
            keychainInfoLabel.stringValue = "Enter host and user to look up the macOS Keychain."
            return
        }
        let port = Int(portField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 22
        if TerminalLaneKeychain.shared.hasPassword(host: host, user: user, port: port) {
            keychainInfoLabel.stringValue = "✓ The macOS Keychain already has an SSH password for \(user)@\(host) — leave the field blank to keep it, or type a new one to replace it."
        } else {
            keychainInfoLabel.stringValue = "No Keychain item for \(user)@\(host) yet — the password you enter is saved there (never in the profile)."
        }
    }

    func controlTextDidChange(_ notification: Notification) {
        updateKeychainInfo()
    }

    @objc private func saveProfile() {
        do {
            let profile = try makeProfile(status: "saving")
            // The profile (metadata) saves first so a Keychain hiccup can't lose it.
            try TerminalLaneProfileStore.shared.upsert(profile)
            let password = passwordField.stringValue
            if profile.authMethod == .password_keychain, let key = profile.keychainKey,
               !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Only the VALUE goes to Keychain — never into the profile/daemon.
                try TerminalLaneKeychain.shared.savePassword(password, host: key.host, user: key.user, port: key.port, displayName: profile.displayName)
                passwordField.stringValue = ""
            }
            updateKeychainInfo()
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
        // Only password_keychain captures a Keychain password.
        let showPassword = method == .password_keychain
        form?.row(at: passwordRowIndex).isHidden = !showPassword
        form?.row(at: keychainInfoRowIndex).isHidden = !showPassword
        if showPassword { updateKeychainInfo() }

        statusLabel.textColor = .secondaryLabelColor
        switch method {
        case .local:
            statusLabel.stringValue = "Local profiles run a shell on this Mac (localhost); no key material is needed."
        case .ssh_key_agent:
            statusLabel.stringValue = "Uses your ssh-agent / default keys. Auto-connectable. No secret is stored."
        case .ssh_key_file:
            statusLabel.stringValue = "Connects with the key file at the path above (metadata only). Auto-connectable."
        case .password_keychain:
            statusLabel.stringValue = "Password lives in the macOS Keychain, keyed by user@host:port. Not auto-connectable yet — connect manually, or use key auth."
        case .manual_password:
            statusLabel.stringValue = "You'll be prompted for the password when you open the terminal; nothing is stored."
        }
    }

    @objc private func useLocalDefaults() {
        let profile = TerminalLaneProfile.localDefault()
        idField.stringValue = profile.id
        idField.isEditable = true
        nameField.stringValue = profile.displayName
        selectAuthMethod(.local)
        hostField.stringValue = ""
        userField.stringValue = profile.user ?? NSUserName()
        portField.stringValue = ""
        shellField.stringValue = profile.shell ?? ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        keyPathField.stringValue = ""
        passwordField.stringValue = ""
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
        let password = passwordField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !id.isEmpty else { throw ValidationError("Profile id is required.") }
        if method != .local {
            guard !host.isEmpty else { throw ValidationError("Enter a host for SSH profiles.") }
            guard !user.isEmpty else { throw ValidationError("Enter a user for SSH profiles.") }
        }
        if method.needsKeyPath, keyPath.isEmpty {
            throw ValidationError("Enter the key file path for an SSH key (file) profile.")
        }
        if method == .password_keychain, password.isEmpty, !existingKeychainPassword() {
            throw ValidationError("Enter the SSH password — the macOS Keychain has no item for \(user)@\(host) yet.")
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
            // Auto-derived marker; the Keychain item is keyed by host/user/port.
            credentialRef: method == .password_keychain ? TerminalLaneProfile.derivedCredentialRef(profileId: id) : nil,
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
