import AppKit

/// Operator-facing presentation for the auth strategies. Kept in the view layer
/// (not the model) so the friendly "Username + password" wording never lands in
/// the secret-free data model.
extension BrowserLaneAuthStrategy {
    /// Order shown in the Sign-in method picker — simplest first.
    static var displayOrder: [BrowserLaneAuthStrategy] {
        [.manualSession, .googleSso, .microsoftSso, .keychainPassword]
    }

    var pickerTitle: String {
        switch self {
        case .manualSession:    return "Manual session"
        case .googleSso:        return "Google sign-in"
        case .microsoftSso:     return "Microsoft sign-in"
        case .keychainPassword: return "Username + password"
        }
    }
}

final class AddSiteViewController: NSViewController {
    private let store = BrowserLaneSiteStore.shared
    private let keychain = BrowserLaneKeychain.shared
    private let daemon = BrowserLaneDaemonClient.shared

    // Primary fields.
    private let nameField = NSTextField()
    private let websiteField = NSTextField()
    private let strategyPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let accountEmailField = NSTextField()
    private let usernameField = NSTextField()
    private let passwordField = NSSecureTextField()

    // Advanced fields.
    private let idField = NSTextField()
    private let domainsField = NSTextField()
    private let loginOverrideField = NSTextField()
    private let credentialRefField = NSTextField()
    private let credentialRefLabel = NSTextField(labelWithString: "Session label")

    private let strategyHelp = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private let titleLabel = NSTextField(labelWithString: "New Site")
    private let advancedToggle = NSButton()

    // Row containers we show/hide.
    private var usernameRow: NSView!
    private var passwordRow: NSView!
    private var advancedStack: NSStackView!
    private var advancedShown = false
    private var idManuallyEdited = false

    // When editing, the original site (createdAt preserved, secret kept if blank).
    private var editingSite: BrowserLaneSite?

    private var selectedStrategy: BrowserLaneAuthStrategy {
        BrowserLaneAuthStrategy.displayOrder[max(0, strategyPicker.indexOfSelectedItem)]
    }

    override func loadView() {
        view = NSView()

        let outer = NSStackView()
        outer.orientation = .vertical
        outer.alignment = .leading
        outer.spacing = 18
        outer.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "Add a website Browser Lane can open and keep signed in. Sign-in happens in the browser; passwords stay in your macOS Keychain.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.lineBreakMode = .byWordWrapping
        subtitle.maximumNumberOfLines = 2
        subtitle.preferredMaxLayoutWidth = 520
        let header = NSStackView(views: [titleLabel, subtitle])
        header.orientation = .vertical
        header.alignment = .leading
        header.spacing = 4

        strategyPicker.addItems(withTitles: BrowserLaneAuthStrategy.displayOrder.map { $0.pickerTitle })
        strategyPicker.target = self
        strategyPicker.action = #selector(strategyChanged)
        strategyPicker.translatesAutoresizingMaskIntoConstraints = false

        strategyHelp.textColor = .secondaryLabelColor
        strategyHelp.font = .systemFont(ofSize: 12)
        strategyHelp.lineBreakMode = .byWordWrapping
        strategyHelp.maximumNumberOfLines = 3
        strategyHelp.preferredMaxLayoutWidth = 520

        for field in [nameField, websiteField, accountEmailField, usernameField, passwordField, idField, domainsField, loginOverrideField, credentialRefField] {
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(equalToConstant: 360).isActive = true
        }
        nameField.placeholderString = "HeyGen Studio"
        websiteField.placeholderString = "app.heygen.com"
        accountEmailField.placeholderString = "you@example.com (optional)"
        idField.placeholderString = "auto-generated from the name"
        domainsField.placeholderString = "auto-derived from the website"
        loginOverrideField.placeholderString = "optional — only if sign-in lives elsewhere"
        credentialRefField.placeholderString = "auto: hivematrix.browser.<site>.primary"
        passwordField.placeholderString = "leave blank to keep the saved sign-in"

        nameField.target = self
        nameField.action = #selector(identityEdited)
        websiteField.target = self
        websiteField.action = #selector(identityEdited)
        idField.target = self
        idField.action = #selector(idEdited)

        usernameRow = labeledRow("Username", usernameField)
        passwordRow = labeledRow("Password", passwordField)

        let formStack = NSStackView(views: [
            labeledRow("Name", nameField),
            labeledRow("Website", websiteField),
            labeledRow("Sign-in method", strategyPicker),
            labeledRow("Account email", accountEmailField),
            usernameRow,
            passwordRow,
        ])
        formStack.orientation = .vertical
        formStack.alignment = .leading
        formStack.spacing = 10

        advancedToggle.bezelStyle = .inline
        advancedToggle.isBordered = false
        advancedToggle.target = self
        advancedToggle.action = #selector(toggleAdvanced)

        advancedStack = NSStackView(views: [
            labeledRow("Site ID", idField),
            labeledRow("Allowed domains", domainsField),
            labeledRow("Login URL override", loginOverrideField),
            labeledRow(credentialRefLabel, credentialRefField),
        ])
        advancedStack.orientation = .vertical
        advancedStack.alignment = .leading
        advancedStack.spacing = 10

        let saveButton = NSButton(title: "Save Site", target: self, action: #selector(saveSite))
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        let openButton = NSButton(title: "Open Sign-in", target: self, action: #selector(openAuthFlow))
        openButton.bezelStyle = .rounded
        let presetButton = NSButton(title: "Use HeyGen preset", target: self, action: #selector(useHeyGenDefaults))
        presetButton.bezelStyle = .rounded
        let buttons = NSStackView(views: [saveButton, openButton, presetButton])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 3
        statusLabel.preferredMaxLayoutWidth = 520

        outer.addArrangedSubview(header)
        outer.addArrangedSubview(formStack)
        outer.addArrangedSubview(strategyHelp)
        outer.addArrangedSubview(advancedToggle)
        outer.addArrangedSubview(advancedStack)
        outer.addArrangedSubview(buttons)
        outer.addArrangedSubview(statusLabel)
        view.addSubview(outer)

        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            outer.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            outer.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
            outer.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
        ])

        applyAdvancedVisibility()
        if let id = BrowserLaneEditTarget.shared.consume(), let existing = store.listSites().first(where: { $0.id == id }) {
            loadForEdit(existing)
        } else {
            startEmpty()
        }
    }

    /// One label + field row, kept as an NSStackView so we can hide it by reference.
    private func labeledRow(_ title: String, _ field: NSView) -> NSStackView {
        labeledRow(NSTextField(labelWithString: title), field)
    }

    private func labeledRow(_ label: NSTextField, _ field: NSView) -> NSStackView {
        label.alignment = .right
        label.textColor = .secondaryLabelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        label.widthAnchor.constraint(equalToConstant: 130).isActive = true
        let row = NSStackView(views: [label, field])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        return row
    }

    @objc private func toggleAdvanced() {
        advancedShown.toggle()
        applyAdvancedVisibility()
    }

    private func applyAdvancedVisibility() {
        advancedStack.isHidden = !advancedShown
        advancedToggle.title = (advancedShown ? "▾ Advanced" : "▸ Advanced") + "  (Site ID, allowed domains, login override)"
    }

    // MARK: - Live identity derivation

    @objc private func idEdited() { idManuallyEdited = true }

    /// Regenerate the auto Site ID + credential ref as the operator types Name/Website,
    /// unless they've overridden the id under Advanced.
    @objc private func identityEdited() {
        if !idManuallyEdited { idField.stringValue = suggestedId() }
        syncCredentialRef()
    }

    private func suggestedId() -> String {
        let fromName = browserLaneSlug(nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        if !fromName.isEmpty { return fromName }
        if let host = URL(string: normalizedWebsite())?.host { return browserLaneSlug(host) }
        return ""
    }

    private func currentId() -> String {
        let typed = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return typed.isEmpty ? suggestedId() : typed
    }

    private func syncCredentialRef() {
        guard selectedStrategy.usesKeychainPassword else { return }
        let id = currentId()
        if credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !id.isEmpty {
            credentialRefField.stringValue = "hivematrix.browser.\(id).primary"
        }
    }

    /// Website with an implicit https:// when the operator typed a bare host.
    private func normalizedWebsite() -> String {
        var raw = websiteField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return "" }
        let lower = raw.lowercased()
        if !lower.hasPrefix("http://"), !lower.hasPrefix("https://") {
            raw = "https://" + raw
        }
        return raw
    }

    /// Allowed domains: operator override if typed, else website host + SSO provider hosts.
    private func deriveAllowedDomains() -> [String] {
        let typed = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !typed.isEmpty { return typed }

        var derived: [String] = []
        if let host = URL(string: normalizedWebsite())?.host { derived.append(host) }
        for domain in selectedStrategy.providerDomains where !derived.contains(domain) {
            derived.append(domain)
        }
        return derived
    }

    @objc private func strategyChanged() {
        let strategy = selectedStrategy
        let usesKeychain = strategy.usesKeychainPassword
        usernameRow.isHidden = !usesKeychain
        passwordRow.isHidden = !usesKeychain
        credentialRefLabel.stringValue = usesKeychain ? "Credential ref" : "Session label"

        if usesKeychain {
            syncCredentialRef()
            strategyHelp.stringValue = "Username and password are saved to the macOS Keychain only — never to disk, logs, or the daemon."
        } else {
            strategyHelp.stringValue = "\(strategy.pickerTitle): complete sign-in (and any 2FA/CAPTCHA) yourself via Open Sign-in. No password is stored — Browser Lane only preserves and monitors the session."
        }
    }

    // MARK: - Presets / edit / empty

    private func startEmpty() {
        editingSite = nil
        idManuallyEdited = false
        titleLabel.stringValue = "New Site"
        nameField.stringValue = ""
        websiteField.stringValue = ""
        accountEmailField.stringValue = ""
        usernameField.stringValue = ""
        passwordField.stringValue = ""
        idField.stringValue = ""
        domainsField.stringValue = ""
        loginOverrideField.stringValue = ""
        credentialRefField.stringValue = ""
        strategyPicker.selectItem(at: 0) // Manual session
        strategyChanged()
        setStatus("Enter a name and website, then choose how it signs in.", error: false)
    }

    @objc private func useHeyGenDefaults() {
        editingSite = nil
        idManuallyEdited = true
        titleLabel.stringValue = "New Site"
        let site = BrowserLaneSite.heyGen
        nameField.stringValue = site.displayName
        websiteField.stringValue = site.homeUrl
        accountEmailField.stringValue = site.providerAccount ?? ""
        idField.stringValue = site.id
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        loginOverrideField.stringValue = site.loginUrl
        credentialRefField.stringValue = site.credentialRef
        usernameField.stringValue = ""
        passwordField.stringValue = ""
        selectStrategy(site.strategy)
        strategyChanged()
        setStatus("HeyGen preset loaded (Google sign-in). Use Open Sign-in to sign in, then Save.", error: false)
    }

    private func loadForEdit(_ site: BrowserLaneSite) {
        editingSite = site
        idManuallyEdited = true
        titleLabel.stringValue = "Edit Site"
        nameField.stringValue = site.displayName
        websiteField.stringValue = site.homeUrl
        accountEmailField.stringValue = site.providerAccount ?? ""
        idField.stringValue = site.id
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        // Only surface the login override when it actually differs from the website.
        loginOverrideField.stringValue = (site.loginUrl == site.homeUrl) ? "" : site.loginUrl
        credentialRefField.stringValue = site.credentialRef
        usernameField.stringValue = ""
        passwordField.stringValue = "" // secrets are never read back from Keychain into the form
        selectStrategy(site.strategy)
        strategyChanged()
        setStatus("Editing “\(site.displayName)”. Leave the password blank to keep the saved sign-in.", error: false)
    }

    private func selectStrategy(_ strategy: BrowserLaneAuthStrategy) {
        strategyPicker.selectItem(at: BrowserLaneAuthStrategy.displayOrder.firstIndex(of: strategy) ?? 0)
    }

    // MARK: - Actions

    @objc private func openAuthFlow() {
        let override = loginOverrideField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = override.isEmpty ? normalizedWebsite() : override
        guard let url = URL(string: target), url.scheme?.hasPrefix("http") == true else {
            failField(websiteField, "Enter a valid website (or login override) first.")
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
                // Blank password → keep the existing Keychain secret (no overwrite).
                if !secret.isEmpty {
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
        setStatus("Saved locally. Syncing to HiveMatrix…", error: false)
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
        guard !name.isEmpty else { throw FieldError(nameField, "Name is required.") }

        let home = normalizedWebsite()
        guard URL(string: home)?.scheme?.hasPrefix("http") == true else {
            throw FieldError(websiteField, "Website is required and must be a web address.")
        }

        let id = currentId()
        guard id.range(of: #"^[a-z0-9._:-]+$"#, options: .regularExpression) != nil else {
            throw FieldError(idField, "Site ID may contain lowercase letters, numbers, dot, underscore, colon, or dash.")
        }

        let override = loginOverrideField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let login: String
        if override.isEmpty {
            login = home
        } else {
            guard URL(string: override)?.scheme?.hasPrefix("http") == true else {
                throw FieldError(loginOverrideField, "Login URL override must be a web address.")
            }
            login = override
        }

        let domains = deriveAllowedDomains()
        guard !domains.isEmpty else { throw FieldError(websiteField, "Enter a website so an allowed domain can be derived.") }

        let strategy = selectedStrategy
        var credentialRef = credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if credentialRef.isEmpty {
            credentialRef = strategy.usesKeychainPassword
                ? "hivematrix.browser.\(id).primary"
                : "hivematrix.browser.\(id).session"
        }
        if strategy.usesKeychainPassword {
            guard credentialRef.hasPrefix("hivematrix.browser.") else {
                throw FieldError(credentialRefField, "Credential ref must start with hivematrix.browser.")
            }
        }

        let providerAccount = accountEmailField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
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
