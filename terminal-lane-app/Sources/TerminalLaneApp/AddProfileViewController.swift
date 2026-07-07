import AppKit

final class AddProfileViewController: NSViewController, NSTextFieldDelegate {
    private let idField = TerminalLaneUI.field(placeholder: "aiserver")
    private let nameField = TerminalLaneUI.field(placeholder: "AI Server")
    private let authMethodPopup = TerminalLaneUI.popUp()
    private let hostField = TerminalLaneUI.field(placeholder: "10.80.114.11")
    private let userField = TerminalLaneUI.field(placeholder: "istai")
    private let portField = TerminalLaneUI.field(placeholder: "22")
    private let shellField = TerminalLaneUI.field()
    private let cwdField = TerminalLaneUI.field()
    private let keyPathField = TerminalLaneUI.field(placeholder: "~/.ssh/id_ed25519")
    private let passwordField: NSSecureTextField = TerminalLaneUI.secureField(placeholder: "Stored only in the macOS Keychain")
    private let keychainInfoLabel = TerminalLaneUI.caption("")
    private let statusLabel = TerminalLaneUI.statusPill()

    private let formContainer = NSView()
    private var formStack: NSStackView!

    // When set (from the Profiles screen), we are editing; createdAt is preserved.
    private var editingProfile: TerminalLaneProfile?

    override func loadView() {
        view = NSView()
        authMethodPopup.addItems(withTitles: TerminalLaneAuthMethod.allCases.map(\.label))
        authMethodPopup.target = self
        authMethodPopup.action = #selector(authMethodChanged)
        shellField.stringValue = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        cwdField.stringValue = FileManager.default.homeDirectoryForCurrentUser.path
        for field in [hostField, userField, portField] { field.delegate = self }

        formContainer.translatesAutoresizingMaskIntoConstraints = false

        let title = TerminalLaneUI.largeTitle("Add / Edit Profile")
        let localDefaults = TerminalLaneUI.secondaryButton("Use Local Mac defaults", target: self, action: #selector(useLocalDefaults))
        let test = TerminalLaneUI.secondaryButton("Test connection", target: self, action: #selector(testConnection))
        let save = TerminalLaneUI.primaryButton("Save profile", target: self, action: #selector(saveProfile))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [localDefaults, spacer, test, save])
        buttons.orientation = .horizontal
        buttons.spacing = 10
        buttons.translatesAutoresizingMaskIntoConstraints = false

        formStack = NSStackView(views: [title, formContainer, buttons, statusLabel])
        formStack.orientation = .vertical
        formStack.alignment = .leading
        formStack.spacing = 18
        formStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(formStack)

        NSLayoutConstraint.activate([
            formStack.topAnchor.constraint(equalTo: view.topAnchor, constant: TerminalLaneUI.contentMargin),
            formStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: TerminalLaneUI.contentMargin),
            formStack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -TerminalLaneUI.contentMargin),
            formStack.widthAnchor.constraint(lessThanOrEqualToConstant: 720),
            buttons.widthAnchor.constraint(equalTo: formStack.widthAnchor),
            formContainer.widthAnchor.constraint(equalTo: formStack.widthAnchor),
        ])

        loadEditTargetIfAny()
        authMethodChanged()
    }

    // MARK: Form building

    private func selectedAuthMethod() -> TerminalLaneAuthMethod {
        let index = authMethodPopup.indexOfSelectedItem
        guard index >= 0, index < TerminalLaneAuthMethod.allCases.count else { return .local }
        return TerminalLaneAuthMethod.allCases[index]
    }

    private func selectAuthMethod(_ method: TerminalLaneAuthMethod) {
        authMethodPopup.selectItem(withTitle: method.label)
    }

    private func section(_ caption: String, _ card: NSView) -> NSStackView {
        let stack = NSStackView(views: [TerminalLaneUI.sectionCaption(caption), card])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        card.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        return stack
    }

    /// Rebuild the card layout for the selected auth method so only the relevant
    /// fields show — cleaner than hiding rows in a fixed grid.
    private func rebuildForm() {
        let method = selectedAuthMethod()
        formContainer.subviews.forEach { $0.removeFromSuperview() }

        var sections: [NSView] = []
        sections.append(section("Identity", TerminalLaneUI.card([
            TerminalLaneUI.row("Profile id", idField),
            TerminalLaneUI.row("Display name", nameField),
            TerminalLaneUI.row("Auth method", authMethodPopup),
        ])))

        if method != .local {
            sections.append(section("Connection", TerminalLaneUI.card([
                TerminalLaneUI.row("Host", hostField),
                TerminalLaneUI.row("User", userField),
                TerminalLaneUI.row("Port", portField),
            ])))
        }

        if method.needsKeyPath {
            sections.append(section("Key", TerminalLaneUI.card([
                TerminalLaneUI.row("Key file path", keyPathField),
            ])))
        }

        if method == .password_keychain {
            let card = TerminalLaneUI.card([TerminalLaneUI.row("Password", passwordField)])
            let wrap = NSStackView(views: [TerminalLaneUI.sectionCaption("Authentication"), card, keychainInfoLabel])
            wrap.orientation = .vertical
            wrap.alignment = .leading
            wrap.spacing = 6
            card.widthAnchor.constraint(equalTo: wrap.widthAnchor).isActive = true
            keychainInfoLabel.widthAnchor.constraint(equalTo: wrap.widthAnchor).isActive = true
            sections.append(wrap)
            updateKeychainInfo()
        }

        sections.append(section("Shell", TerminalLaneUI.card([
            TerminalLaneUI.row("Shell", shellField),
            TerminalLaneUI.row("Working dir", cwdField),
        ])))

        let container = NSStackView(views: sections)
        container.orientation = .vertical
        container.alignment = .leading
        container.spacing = 18
        container.translatesAutoresizingMaskIntoConstraints = false
        formContainer.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: formContainer.topAnchor),
            container.bottomAnchor.constraint(equalTo: formContainer.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: formContainer.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: formContainer.trailingAnchor),
        ])
        for case let section as NSStackView in sections {
            section.widthAnchor.constraint(equalTo: container.widthAnchor).isActive = true
        }
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

    // MARK: Keychain hints

    // The Keychain item is keyed by host + user + port (Internet Password) —
    // shared with other SSH tools on this Mac, so an item already saved for
    // user@host is found and reused here.
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
            keychainInfoLabel.stringValue = "✓ The macOS Keychain already has an SSH password for \(user)@\(host) — leave the field blank to keep it, or type a new one to replace it. Sessions connect natively with it."
        } else {
            keychainInfoLabel.stringValue = "No Keychain item for \(user)@\(host) yet — the password you enter is saved there (never in the profile) and used to auto-connect."
        }
    }

    func controlTextDidChange(_ notification: Notification) {
        updateKeychainInfo()
    }

    // MARK: Actions

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
            setStatus("Saved locally…", color: .secondaryLabelColor)
            TerminalLaneDaemonClient.shared.sync(profile: profile) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let message): self?.setStatus(message, color: .systemGreen)
                    case .failure(let error): self?.setStatus(error.localizedDescription, color: .systemRed)
                    }
                }
            }
        } catch {
            setStatus(error.localizedDescription, color: .systemRed)
        }
    }

    @objc private func testConnection() {
        let profile: TerminalLaneProfile
        do { profile = try makeProfile(status: "checking") }
        catch { setStatus(error.localizedDescription, color: .systemRed); return }

        // password_keychain is verified natively (Citadel) with the Keychain
        // password — the daemon can't authenticate a password non-interactively.
        if profile.authMethod == .password_keychain, let key = profile.keychainKey {
            guard let password = TerminalLaneKeychain.shared.readPassword(host: key.host, user: key.user, port: key.port) else {
                setStatus("No password in the macOS Keychain for \(key.user)@\(key.host) — enter one and Save first.", color: .systemOrange)
                return
            }
            setStatus("Connecting…", color: .secondaryLabelColor)
            Task { @MainActor in
                do {
                    try await TerminalLaneSSHService().verify(host: key.host, port: key.port, user: key.user, password: password)
                    setStatus("✓ Connected — the Keychain password authenticated.", color: .systemGreen)
                } catch {
                    setStatus(error.localizedDescription, color: .systemRed)
                }
            }
            return
        }

        TerminalLaneDaemonClient.shared.runReadiness(profileId: profile.id) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let message): self?.setStatus(message, color: .secondaryLabelColor)
                case .failure(let error): self?.setStatus(error.localizedDescription, color: .systemRed)
                }
            }
        }
    }

    @objc private func authMethodChanged() {
        rebuildForm()
        let method = selectedAuthMethod()
        switch method {
        case .local:
            setStatus("Local profiles run a shell on this Mac (localhost); no key material is needed.", color: .secondaryLabelColor)
        case .ssh_key_agent:
            setStatus("Uses your ssh-agent / default keys. Auto-connectable. No secret is stored.", color: .secondaryLabelColor)
        case .ssh_key_file:
            setStatus("Connects with the key file at the path above (metadata only). Auto-connectable.", color: .secondaryLabelColor)
        case .password_keychain:
            setStatus("Password lives in the macOS Keychain, keyed by user@host:port. Sessions auto-connect natively with it.", color: .secondaryLabelColor)
        case .manual_password:
            setStatus("You'll be prompted for the password when you open the terminal; nothing is stored.", color: .secondaryLabelColor)
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

    private func setStatus(_ text: String, color: NSColor) {
        statusLabel.textColor = color
        statusLabel.stringValue = text
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

    private struct ValidationError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
