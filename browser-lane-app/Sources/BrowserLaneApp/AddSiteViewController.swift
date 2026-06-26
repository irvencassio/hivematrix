import AppKit

final class AddSiteViewController: NSViewController {
    private let store = BrowserLaneSiteStore.shared
    private let keychain = BrowserLaneKeychain.shared
    private let daemon = BrowserLaneDaemonClient.shared

    private let idField = NSTextField()
    private let nameField = NSTextField()
    private let homeField = NSTextField()
    private let loginField = NSTextField()
    private let domainsField = NSTextField()
    private let strategyPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let providerAccountField = NSTextField()
    private let credentialRefField = NSTextField()
    private let usernameField = NSTextField()
    private let passwordField = NSSecureTextField()
    private let strategyHelp = NSTextField(labelWithString: "")
    private let credentialRefLabel = NSTextField(labelWithString: "Credential ref")
    private let advancedToggle = NSButton()
    private let statusLabel = NSTextField(labelWithString: "")
    private let titleLabel = NSTextField(labelWithString: "Add Site")

    private var grid: NSGridView!
    private var idRowIndex = 0
    private var credentialRefRowIndex = 0
    private var usernameRowIndex = 0
    private var passwordRowIndex = 0
    private var advancedShown = false

    // When editing, the original site (createdAt preserved, secret kept if blank).
    private var editingSite: BrowserLaneSite?

    private var selectedStrategy: BrowserLaneAuthStrategy {
        BrowserLaneAuthStrategy.allCases[max(0, strategyPicker.indexOfSelectedItem)]
    }

    override func loadView() {
        view = NSView()

        let outer = NSStackView()
        outer.orientation = .vertical
        outer.alignment = .leading
        outer.spacing = 14
        outer.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 28, weight: .semibold)

        let subtitle = NSTextField(labelWithString: "Register site metadata and pick how it authenticates. Secrets live only in macOS Keychain.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.font = .systemFont(ofSize: 14)

        strategyPicker.addItems(withTitles: BrowserLaneAuthStrategy.allCases.map { $0.label })
        strategyPicker.target = self
        strategyPicker.action = #selector(strategyChanged)
        strategyPicker.translatesAutoresizingMaskIntoConstraints = false

        strategyHelp.textColor = .secondaryLabelColor
        strategyHelp.font = .systemFont(ofSize: 12)
        strategyHelp.lineBreakMode = .byWordWrapping
        strategyHelp.maximumNumberOfLines = 2

        advancedToggle.title = "▸ Advanced (Site id, Credential ref)"
        advancedToggle.bezelStyle = .inline
        advancedToggle.isBordered = false
        advancedToggle.target = self
        advancedToggle.action = #selector(toggleAdvanced)

        // Display name + domain come first; the technical id/ref live under Advanced.
        let rows: [[NSView]] = [
            row("Display name", nameField),
            row("Home URL", homeField),
            row("Login / auth URL", loginField),
            row("Allowed domains", domainsField),
            [NSTextField(labelWithString: "Auth strategy"), strategyPicker],
            row("Provider account / email", providerAccountField),
            row("Username", usernameField),
            row("Password", passwordField),
            row("Site id", idField),
            [credentialRefLabel, credentialRefField],
        ]
        usernameRowIndex = 6
        passwordRowIndex = 7
        idRowIndex = 8
        credentialRefRowIndex = 9

        grid = NSGridView(views: rows)
        grid.rowSpacing = 10
        grid.columnSpacing = 12
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 520

        for field in [idField, nameField, homeField, loginField, domainsField, providerAccountField, credentialRefField, usernameField, passwordField] {
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(greaterThanOrEqualToConstant: 420).isActive = true
        }
        nameField.placeholderString = "HeyGen Studio"
        domainsField.placeholderString = "app.heygen.com, heygen.com"
        idField.placeholderString = "auto-generated from the display name"
        credentialRefField.placeholderString = "auto: hivematrix.browser.<site>.primary"
        providerAccountField.placeholderString = "cassio.irv@gmail.com (optional, non-secret)"
        passwordField.placeholderString = "leave blank to keep the existing Keychain secret"
        // Regenerate ids live as the operator types the name (unless overridden via Advanced).
        nameField.target = self
        nameField.action = #selector(nameEdited)

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 10
        let heygenButton = NSButton(title: "Use HeyGen defaults", target: self, action: #selector(useHeyGenDefaults))
        let saveButton = NSButton(title: "Save site", target: self, action: #selector(saveSite))
        let openButton = NSButton(title: "Open auth flow", target: self, action: #selector(openAuthFlow))
        saveButton.bezelStyle = .rounded
        openButton.bezelStyle = .rounded
        buttons.addArrangedSubview(heygenButton)
        buttons.addArrangedSubview(saveButton)
        buttons.addArrangedSubview(openButton)

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 3

        outer.addArrangedSubview(titleLabel)
        outer.addArrangedSubview(subtitle)
        outer.addArrangedSubview(grid)
        outer.addArrangedSubview(advancedToggle)
        outer.addArrangedSubview(strategyHelp)
        outer.addArrangedSubview(buttons)
        outer.addArrangedSubview(statusLabel)
        view.addSubview(outer)

        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            outer.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            outer.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
        ])

        applyAdvancedVisibility()
        if let id = BrowserLaneEditTarget.shared.consume(), let existing = store.listSites().first(where: { $0.id == id }) {
            loadForEdit(existing)
        } else {
            useHeyGenDefaults()
        }
    }

    private func row(_ label: String, _ field: NSTextField) -> [NSView] {
        let labelView = NSTextField(labelWithString: label)
        labelView.textColor = .secondaryLabelColor
        return [labelView, field]
    }

    @objc private func toggleAdvanced() {
        advancedShown.toggle()
        applyAdvancedVisibility()
    }

    private func applyAdvancedVisibility() {
        grid.row(at: idRowIndex).isHidden = !advancedShown
        grid.row(at: credentialRefRowIndex).isHidden = !advancedShown
        advancedToggle.title = (advancedShown ? "▾" : "▸") + " Advanced (Site id, Credential ref)"
    }

    /// Auto-fill the site id (and Keychain credentialRef) from the display name,
    /// unless the operator has typed their own under Advanced.
    @objc private func nameEdited() {
        let typedId = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let suggested = suggestedId()
        // Only auto-update when the id was empty or still matches a prior suggestion.
        if typedId.isEmpty || editingSite == nil {
            idField.stringValue = suggested
            syncCredentialRef()
        }
    }

    private func suggestedId() -> String {
        let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let fromName = browserLaneSlug(name)
        if !fromName.isEmpty { return fromName }
        let firstDomain = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .first.map(String.init) ?? ""
        return browserLaneSlug(firstDomain)
    }

    private func syncCredentialRef() {
        guard selectedStrategy.usesKeychainPassword else { return }
        let id = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !id.isEmpty {
            credentialRefField.stringValue = "hivematrix.browser.\(id).primary"
        }
    }

    @objc private func strategyChanged() {
        let strategy = selectedStrategy
        let usesKeychainPassword = strategy.usesKeychainPassword
        grid.row(at: usernameRowIndex).isHidden = !usesKeychainPassword
        grid.row(at: passwordRowIndex).isHidden = !usesKeychainPassword
        credentialRefLabel.stringValue = usesKeychainPassword ? "Credential ref" : "Session label (optional)"

        if usesKeychainPassword {
            syncCredentialRef()
            strategyHelp.stringValue = "Username + password are saved to the macOS Keychain only — never to disk, logs, or the daemon. On edit, leave the password blank to keep the existing secret."
        } else {
            strategyHelp.stringValue = "\(strategy.label): complete sign-in (and 2FA/CAPTCHA) yourself in Browser Lane via Open auth flow. No password is stored — Browser Lane only preserves and monitors the session."
            seedProviderDomains(strategy)
            if let authURL = strategy.defaultAuthURL, loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                loginField.stringValue = authURL
            }
        }
    }

    private func seedProviderDomains(_ strategy: BrowserLaneAuthStrategy) {
        guard !strategy.providerDomains.isEmpty else { return }
        var domains = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        for domain in strategy.providerDomains where !domains.contains(domain) {
            domains.append(domain)
        }
        domainsField.stringValue = domains.joined(separator: ", ")
    }

    @objc private func useHeyGenDefaults() {
        editingSite = nil
        titleLabel.stringValue = "Add Site"
        let site = BrowserLaneSite.heyGen
        idField.stringValue = site.id
        nameField.stringValue = site.displayName
        homeField.stringValue = site.homeUrl
        loginField.stringValue = site.loginUrl
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        credentialRefField.stringValue = site.credentialRef
        providerAccountField.stringValue = site.providerAccount ?? ""
        usernameField.stringValue = ""
        passwordField.stringValue = ""
        if let index = BrowserLaneAuthStrategy.allCases.firstIndex(of: site.strategy) {
            strategyPicker.selectItem(at: index)
        }
        strategyChanged()
        setStatus("HeyGen defaults loaded (Google SSO). Use Open auth flow to sign in, then Save.", error: false)
    }

    private func loadForEdit(_ site: BrowserLaneSite) {
        editingSite = site
        titleLabel.stringValue = "Edit Site"
        idField.stringValue = site.id
        nameField.stringValue = site.displayName
        homeField.stringValue = site.homeUrl
        loginField.stringValue = site.loginUrl
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        credentialRefField.stringValue = site.credentialRef
        providerAccountField.stringValue = site.providerAccount ?? ""
        usernameField.stringValue = ""
        passwordField.stringValue = "" // secrets are never read back from Keychain into the form
        if let index = BrowserLaneAuthStrategy.allCases.firstIndex(of: site.strategy) {
            strategyPicker.selectItem(at: index)
        }
        strategyChanged()
        setStatus("Editing “\(site.displayName)”. Leave the password blank to keep the existing Keychain secret.", error: false)
    }

    @objc private func openAuthFlow() {
        let raw = loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = raw.isEmpty ? (selectedStrategy.defaultAuthURL ?? "") : raw
        guard let url = URL(string: target), url.scheme?.hasPrefix("http") == true else {
            failField(loginField, "Login / auth URL is invalid.")
            return
        }
        BrowserLaneNavigator.shared.openInBrowser(url)
        setStatus("Opened \(url.host ?? url.absoluteString) in Browser Lane — finish sign-in there.", error: false)
    }

    @objc private func saveSite() {
        do {
            let site = try buildSite()
            if site.strategy.usesKeychainPassword {
                let username = usernameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                let secret = passwordField.stringValue
                if secret.isEmpty {
                    // Blank password → keep the existing Keychain secret (no overwrite).
                    // On a brand-new keychain site with no secret yet, that's allowed too;
                    // the operator can add credentials later.
                } else {
                    guard !username.isEmpty else {
                        failField(usernameField, "Enter a username to go with the new password.")
                        return
                    }
                    try keychain.saveCredential(siteId: site.id, credentialRef: site.credentialRef, username: username, password: secret)
                }
            }
            try store.upsert(site)
            finishSync(site)
        } catch let error as FieldError {
            failField(error.field, error.message)
        } catch {
            setStatus(error.localizedDescription, error: true)
        }
    }

    private func finishSync(_ site: BrowserLaneSite) {
        setStatus("Saved locally. Syncing metadata to HiveMatrix…", error: false)
        daemon.sync(site: site) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let message):
                    var synced = site
                    synced.lastSyncStatus = message
                    synced.updatedAt = BrowserLaneSite.nowString()
                    try? self?.store.upsert(synced)
                    self?.setStatus(message, error: false)
                case .failure(let error):
                    self?.setStatus("Saved locally — daemon sync FAILED: \(error.localizedDescription)", error: true)
                }
            }
        }
    }

    private func buildSite() throws -> BrowserLaneSite {
        let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw FieldError(nameField, "Display name is required.") }

        // Auto-generate the id from the name/domain when none was typed (Advanced).
        var id = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if id.isEmpty { id = suggestedId() }
        guard id.range(of: #"^[a-z0-9._:-]+$"#, options: .regularExpression) != nil else {
            throw FieldError(idField, "Site id may contain lowercase letters, numbers, dot, underscore, colon, or dash.")
        }

        let home = homeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let login = loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let providerAccount = providerAccountField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let strategy = selectedStrategy
        let domains = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard URL(string: home)?.scheme?.hasPrefix("http") == true else { throw FieldError(homeField, "Home URL must be http(s).") }
        guard URL(string: login)?.scheme?.hasPrefix("http") == true else { throw FieldError(loginField, "Login / auth URL must be http(s).") }
        guard !domains.isEmpty else { throw FieldError(domainsField, "At least one allowed domain is required.") }

        // Auto-generate a Keychain credentialRef when blank; require the prefix.
        var credentialRef = credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if strategy.usesKeychainPassword {
            if credentialRef.isEmpty { credentialRef = "hivematrix.browser.\(id).primary" }
            guard credentialRef.hasPrefix("hivematrix.browser.") else {
                throw FieldError(credentialRefField, "Credential ref must start with hivematrix.browser.")
            }
        }

        let now = BrowserLaneSite.nowString()
        let existing = editingSite ?? store.listSites().first(where: { $0.id == id })
        return BrowserLaneSite(
            id: id,
            displayName: name,
            homeUrl: home,
            loginUrl: login,
            allowedDomains: domains,
            credentialRef: credentialRef,
            authStrategy: strategy.rawValue,
            providerAccount: providerAccount.isEmpty ? nil : providerAccount,
            notes: "Managed by Browser Lane app.",
            lastSyncStatus: existing?.lastSyncStatus ?? "not synced",
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        )
    }

    private func setStatus(_ message: String, error: Bool) {
        statusLabel.stringValue = message
        statusLabel.textColor = error ? .systemRed : .secondaryLabelColor
    }

    /// Field-specific error: focus the offending field and show a red message.
    private func failField(_ field: NSControl, _ message: String) {
        setStatus(message, error: true)
        view.window?.makeFirstResponder(field)
    }

    private struct FieldError: Error {
        let field: NSControl
        let message: String
        init(_ field: NSControl, _ message: String) { self.field = field; self.message = message }
    }
}
