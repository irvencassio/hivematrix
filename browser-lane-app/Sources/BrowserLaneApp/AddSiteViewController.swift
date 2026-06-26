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
    private let statusLabel = NSTextField(labelWithString: "")

    private var grid: NSGridView!
    private var usernameRowIndex = 0
    private var passwordRowIndex = 0

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

        let title = NSTextField(labelWithString: "Add Site")
        title.font = .systemFont(ofSize: 28, weight: .semibold)

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

        let rows: [[NSView]] = [
            row("Site id", idField),
            row("Display name", nameField),
            row("Home URL", homeField),
            row("Login / auth URL", loginField),
            row("Allowed domains", domainsField),
            [NSTextField(labelWithString: "Auth strategy"), strategyPicker],
            row("Provider account / email", providerAccountField),
            [credentialRefLabel, credentialRefField],
            row("Username", usernameField),
            row("Password", passwordField),
        ]
        usernameRowIndex = 8
        passwordRowIndex = 9

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
        domainsField.placeholderString = "app.heygen.com, heygen.com"
        credentialRefField.placeholderString = "hivematrix.browser.<site>.primary"
        providerAccountField.placeholderString = "cassio.irv@gmail.com (optional, non-secret)"

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

        outer.addArrangedSubview(title)
        outer.addArrangedSubview(subtitle)
        outer.addArrangedSubview(grid)
        outer.addArrangedSubview(strategyHelp)
        outer.addArrangedSubview(buttons)
        outer.addArrangedSubview(statusLabel)
        view.addSubview(outer)

        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            outer.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            outer.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
        ])

        useHeyGenDefaults()
    }

    private func row(_ label: String, _ field: NSTextField) -> [NSView] {
        let labelView = NSTextField(labelWithString: label)
        labelView.textColor = .secondaryLabelColor
        return [labelView, field]
    }

    /// Show username/password only for the Keychain strategy; SSO/manual sites are
    /// human handoffs and capture no secret.
    @objc private func strategyChanged() {
        let strategy = selectedStrategy
        let usesKeychainPassword = strategy.usesKeychainPassword
        grid.row(at: usernameRowIndex).isHidden = !usesKeychainPassword
        grid.row(at: passwordRowIndex).isHidden = !usesKeychainPassword
        credentialRefLabel.stringValue = usesKeychainPassword ? "Credential ref" : "Session label (optional)"

        if usesKeychainPassword {
            strategyHelp.stringValue = "Username + password are saved to the macOS Keychain only — never to disk, logs, or the daemon."
        } else {
            strategyHelp.stringValue = "\(strategy.label): complete sign-in (and 2FA/CAPTCHA) yourself in Browser Lane via Open auth flow. No password is stored — Browser Lane only preserves and monitors the session."
            // Seed provider auth domains so readiness/popup matching recognises them.
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
        let site = BrowserLaneSite.heyGen
        idField.stringValue = site.id
        nameField.stringValue = site.displayName
        homeField.stringValue = site.homeUrl
        loginField.stringValue = site.loginUrl
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        credentialRefField.stringValue = site.credentialRef
        providerAccountField.stringValue = site.providerAccount ?? ""
        if let index = BrowserLaneAuthStrategy.allCases.firstIndex(of: site.strategy) {
            strategyPicker.selectItem(at: index)
        }
        strategyChanged()
        statusLabel.stringValue = "HeyGen defaults loaded (Google SSO). Use Open auth flow to sign in, then Save."
    }

    @objc private func openAuthFlow() {
        let raw = loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = raw.isEmpty ? (selectedStrategy.defaultAuthURL ?? "") : raw
        guard let url = URL(string: target), url.scheme?.hasPrefix("http") == true else {
            statusLabel.stringValue = "Login / auth URL is invalid."
            return
        }
        // Hand off to the persistent in-app browser so the signed-in session is reused.
        BrowserLaneNavigator.shared.openInBrowser(url)
        statusLabel.stringValue = "Opened \(url.host ?? url.absoluteString) in Browser Lane — finish sign-in there."
    }

    @objc private func saveSite() {
        do {
            let site = try buildSite()
            if site.strategy.usesKeychainPassword {
                let username = usernameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                let secret = passwordField.stringValue
                if !username.isEmpty || !secret.isEmpty {
                    guard !username.isEmpty, !secret.isEmpty else {
                        statusLabel.stringValue = "Enter both username and password, or leave both blank."
                        return
                    }
                    try keychain.saveCredential(siteId: site.id, credentialRef: site.credentialRef, username: username, password: secret)
                }
            }

            try store.upsert(site)
            statusLabel.stringValue = "Saved locally. Syncing metadata to HiveMatrix..."
            daemon.sync(site: site) { [weak self] result in
                DispatchQueue.main.async {
                    let message = (try? result.get()) ?? "saved locally; daemon sync failed"
                    var synced = site
                    synced.lastSyncStatus = message
                    synced.updatedAt = BrowserLaneSite.nowString()
                    try? self?.store.upsert(synced)
                    self?.statusLabel.stringValue = message
                }
            }
        } catch {
            statusLabel.stringValue = error.localizedDescription
        }
    }

    private func buildSite() throws -> BrowserLaneSite {
        let id = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let home = homeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let login = loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialRef = credentialRefField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let providerAccount = providerAccountField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let strategy = selectedStrategy
        let domains = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard id.range(of: #"^[a-z0-9._:-]+$"#, options: .regularExpression) != nil else {
            throw NSError(domain: "BrowserLane", code: 1, userInfo: [NSLocalizedDescriptionKey: "Site id may contain lowercase letters, numbers, dot, underscore, colon, or dash."])
        }
        guard !name.isEmpty else { throw NSError(domain: "BrowserLane", code: 2, userInfo: [NSLocalizedDescriptionKey: "Display name is required."]) }
        guard URL(string: home)?.scheme?.hasPrefix("http") == true else { throw NSError(domain: "BrowserLane", code: 3, userInfo: [NSLocalizedDescriptionKey: "Home URL must be http(s)."]) }
        guard URL(string: login)?.scheme?.hasPrefix("http") == true else { throw NSError(domain: "BrowserLane", code: 4, userInfo: [NSLocalizedDescriptionKey: "Login / auth URL must be http(s)."]) }
        guard !domains.isEmpty else { throw NSError(domain: "BrowserLane", code: 5, userInfo: [NSLocalizedDescriptionKey: "At least one allowed domain is required."]) }
        // The Keychain reference prefix is required only for the Keychain strategy.
        // For SSO/manual, the field is an optional non-secret session label.
        if strategy.usesKeychainPassword {
            guard credentialRef.hasPrefix("hivematrix.browser.") else {
                throw NSError(domain: "BrowserLane", code: 6, userInfo: [NSLocalizedDescriptionKey: "Credential ref must start with hivematrix.browser."])
            }
        }

        let now = BrowserLaneSite.nowString()
        let existing = store.listSites().first(where: { $0.id == id })
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
}
