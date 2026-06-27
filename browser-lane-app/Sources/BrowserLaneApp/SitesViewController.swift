import AppKit

final class SitesViewController: NSViewController {
    private let stack = NSStackView()
    private let store = BrowserLaneSiteStore.shared
    private let keychain = BrowserLaneKeychain.shared

    override func loadView() {
        view = NSView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
        ])
        render()
    }

    private func render() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let title = NSTextField(labelWithString: "Sites")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "Websites Browser Lane keeps signed in. Passwords live only in your macOS Keychain.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.font = .systemFont(ofSize: 13)

        let newSite = NSButton(title: "New Site", target: self, action: #selector(newSiteTapped))
        newSite.bezelStyle = .rounded
        newSite.keyEquivalent = "\r"
        let refresh = NSButton(title: "Refresh", target: self, action: #selector(refreshSites))
        refresh.bezelStyle = .rounded
        let actions = NSStackView(views: [newSite, refresh])
        actions.orientation = .horizontal
        actions.spacing = 10

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(actions)

        let sites = store.listSites()
        if sites.isEmpty {
            let empty = NSTextField(labelWithString: "No sites yet. Choose New Site to add one — just a name, a website, and how it signs in.")
            empty.textColor = .tertiaryLabelColor
            empty.lineBreakMode = .byWordWrapping
            empty.maximumNumberOfLines = 0
            empty.preferredMaxLayoutWidth = 520
            stack.addArrangedSubview(empty)
            return
        }

        for site in sites {
            stack.addArrangedSubview(siteCard(site))
        }
    }

    private func siteCard(_ site: BrowserLaneSite) -> NSView {
        let box = NSBox()
        box.title = site.displayName
        box.boxType = .primary
        box.translatesAutoresizingMaskIntoConstraints = false
        // The whole card is click-to-edit, with explicit buttons for discoverability.
        box.identifier = NSUserInterfaceItemIdentifier(site.id)
        let click = NSClickGestureRecognizer(target: self, action: #selector(cardClicked(_:)))
        box.addGestureRecognizer(click)

        let strategy = site.strategy
        let credentialLabel = strategy.usesKeychainPassword ? "Credential ref" : "Session label"
        let account = (site.providerAccount?.isEmpty == false) ? site.providerAccount! : "—"
        let text = NSTextField(labelWithString:
            "Sign-in: \(strategy.pickerTitle)\nAccount: \(account)\nWebsite: \(site.homeUrl)\nDomains: \(site.allowedDomains.joined(separator: ", "))\n\(credentialLabel): \(site.credentialRef)\nSync: \(site.lastSyncStatus)"
        )
        text.lineBreakMode = .byWordWrapping
        text.maximumNumberOfLines = 0
        text.textColor = .secondaryLabelColor

        let editButton = NSButton(title: "Edit", target: self, action: #selector(editSite(_:)))
        editButton.identifier = NSUserInterfaceItemIdentifier(site.id)
        editButton.bezelStyle = .rounded
        let deleteButton = NSButton(title: "Delete", target: self, action: #selector(deleteSite(_:)))
        deleteButton.identifier = NSUserInterfaceItemIdentifier(site.id)
        deleteButton.bezelStyle = .rounded
        deleteButton.hasDestructiveAction = true
        let buttons = NSStackView(views: [editButton, deleteButton])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        let content = NSStackView(views: [text, buttons])
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 10
        content.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(content)
        NSLayoutConstraint.activate([
            box.widthAnchor.constraint(greaterThanOrEqualToConstant: 540),
            content.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 12),
            content.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -12),
            content.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 10),
            content.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -10),
        ])
        return box
    }

    @objc private func cardClicked(_ sender: NSClickGestureRecognizer) {
        guard let id = sender.view?.identifier?.rawValue else { return }
        beginEdit(id)
    }

    @objc private func editSite(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        beginEdit(id)
    }

    private func beginEdit(_ id: String) {
        // Hand off the id only; Edit Site reloads and prefills the full site.
        BrowserLaneEditTarget.shared.siteId = id
        NotificationCenter.default.post(name: .browserLaneNavigate, object: Screen.addSite)
    }

    @objc private func newSiteTapped() {
        BrowserLaneEditTarget.shared.siteId = nil
        NotificationCenter.default.post(name: .browserLaneNavigate, object: Screen.addSite)
    }

    @objc private func deleteSite(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue,
              let site = store.listSites().first(where: { $0.id == id }) else { return }

        let alert = NSAlert()
        alert.messageText = "Delete “\(site.displayName)”?"
        alert.informativeText = "This removes the site from Browser Lane and deletes its saved sign-in from your macOS Keychain. This can’t be undone."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        try? store.delete(id: id)
        keychain.deleteCredential(siteId: id)
        render()
    }

    @objc private func refreshSites() {
        render()
    }
}
