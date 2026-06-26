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
    private let credentialRefField = NSTextField()
    private let usernameField = NSTextField()
    private let passwordField = NSSecureTextField()
    private let statusLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()

        let outer = NSStackView()
        outer.orientation = .vertical
        outer.alignment = .leading
        outer.spacing = 14
        outer.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Add Site")
        title.font = .systemFont(ofSize: 28, weight: .semibold)

        let subtitle = NSTextField(labelWithString: "Register site metadata and save credentials to macOS Keychain.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.font = .systemFont(ofSize: 14)

        let grid = NSGridView(views: [
            row("Site id", idField),
            row("Display name", nameField),
            row("Home URL", homeField),
            row("Login URL", loginField),
            row("Allowed domains", domainsField),
            row("Credential ref", credentialRefField),
            row("Username", usernameField),
            row("Password", passwordField),
        ])
        grid.rowSpacing = 10
        grid.columnSpacing = 12
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 520

        for field in [idField, nameField, homeField, loginField, domainsField, credentialRefField, usernameField, passwordField] {
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(greaterThanOrEqualToConstant: 420).isActive = true
        }
        domainsField.placeholderString = "app.heygen.com, heygen.com"
        credentialRefField.placeholderString = "hivematrix.browser.<site>.primary"

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 10
        let heygenButton = NSButton(title: "Use HeyGen defaults", target: self, action: #selector(useHeyGenDefaults))
        let saveButton = NSButton(title: "Save site + credentials", target: self, action: #selector(saveSite))
        let openButton = NSButton(title: "Open login URL", target: self, action: #selector(openLoginURL))
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

    @objc private func useHeyGenDefaults() {
        let site = BrowserLaneSite.heyGen
        idField.stringValue = site.id
        nameField.stringValue = site.displayName
        homeField.stringValue = site.homeUrl
        loginField.stringValue = site.loginUrl
        domainsField.stringValue = site.allowedDomains.joined(separator: ", ")
        credentialRefField.stringValue = site.credentialRef
        statusLabel.stringValue = "HeyGen defaults loaded. Enter username/password, then save."
    }

    @objc private func openLoginURL() {
        guard let url = URL(string: loginField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            statusLabel.stringValue = "Login URL is invalid."
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func saveSite() {
        do {
            let site = try buildSite()
            let username = usernameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            let password = passwordField.stringValue
            if !username.isEmpty || !password.isEmpty {
                guard !username.isEmpty, !password.isEmpty else {
                    statusLabel.stringValue = "Enter both username and password, or leave both blank."
                    return
                }
                try keychain.saveCredential(siteId: site.id, credentialRef: site.credentialRef, username: username, password: password)
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
        let domains = domainsField.stringValue
            .split { $0 == "," || $0 == "\n" || $0 == " " }
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard id.range(of: #"^[a-z0-9._:-]+$"#, options: .regularExpression) != nil else {
            throw NSError(domain: "BrowserLane", code: 1, userInfo: [NSLocalizedDescriptionKey: "Site id may contain lowercase letters, numbers, dot, underscore, colon, or dash."])
        }
        guard !name.isEmpty else { throw NSError(domain: "BrowserLane", code: 2, userInfo: [NSLocalizedDescriptionKey: "Display name is required."]) }
        guard URL(string: home)?.scheme?.hasPrefix("http") == true else { throw NSError(domain: "BrowserLane", code: 3, userInfo: [NSLocalizedDescriptionKey: "Home URL must be http(s)."]) }
        guard URL(string: login)?.scheme?.hasPrefix("http") == true else { throw NSError(domain: "BrowserLane", code: 4, userInfo: [NSLocalizedDescriptionKey: "Login URL must be http(s)."]) }
        guard !domains.isEmpty else { throw NSError(domain: "BrowserLane", code: 5, userInfo: [NSLocalizedDescriptionKey: "At least one allowed domain is required."]) }
        guard credentialRef.hasPrefix("hivematrix.browser.") else { throw NSError(domain: "BrowserLane", code: 6, userInfo: [NSLocalizedDescriptionKey: "Credential ref must start with hivematrix.browser."]) }

        let now = BrowserLaneSite.nowString()
        let existing = store.listSites().first(where: { $0.id == id })
        return BrowserLaneSite(
            id: id,
            displayName: name,
            homeUrl: home,
            loginUrl: login,
            allowedDomains: domains,
            credentialRef: credentialRef,
            authStrategy: "keychain_password",
            notes: "Managed by Browser Lane app.",
            lastSyncStatus: existing?.lastSyncStatus ?? "not synced",
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        )
    }
}
