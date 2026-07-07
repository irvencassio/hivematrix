import AppKit

// A real, editable profile table — select a row to edit, delete (with
// confirmation), or duplicate. Columns expose auth method, auto-connect, sync
// state, and credential presence (✓/—) — never a secret value.
final class ProfilesViewController: NSViewController, NSTableViewDataSource, NSTableViewDelegate {
    private let tableView = NSTableView()
    private var profiles: [TerminalLaneProfile] = []
    private let statusLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()
        let title = TerminalLaneUI.largeTitle("Profiles")

        configureColumns()
        tableView.dataSource = self
        tableView.delegate = self
        tableView.style = .inset
        tableView.usesAlternatingRowBackgroundColors = true
        tableView.rowHeight = 30
        tableView.target = self
        tableView.doubleAction = #selector(editProfile)

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        // Wrap the table in a rounded card to match the rest of the app.
        let card = NSBox()
        card.boxType = .custom
        card.titlePosition = .noTitle
        card.fillColor = .controlBackgroundColor
        card.borderColor = .separatorColor
        card.borderWidth = 1
        card.cornerRadius = 10
        card.contentViewMargins = .zero
        card.translatesAutoresizingMaskIntoConstraints = false
        let cardBody = NSView()
        cardBody.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: cardBody.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: cardBody.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: cardBody.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: cardBody.trailingAnchor),
        ])
        card.contentView = cardBody
        card.heightAnchor.constraint(greaterThanOrEqualToConstant: 340).isActive = true

        let edit = TerminalLaneUI.secondaryButton("Edit", target: self, action: #selector(editProfile))
        let duplicate = TerminalLaneUI.secondaryButton("Duplicate", target: self, action: #selector(duplicateProfile))
        let delete = TerminalLaneUI.destructiveButton("Delete", target: self, action: #selector(deleteProfile))
        let refresh = TerminalLaneUI.secondaryButton("Refresh", target: self, action: #selector(reload))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [edit, duplicate, delete, refresh, spacer, statusLabel])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [title, buttons, card])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: TerminalLaneUI.contentMargin),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: TerminalLaneUI.contentMargin),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -TerminalLaneUI.contentMargin),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -TerminalLaneUI.contentMargin),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor),
            card.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        reload()
    }

    private func configureColumns() {
        let columns: [(String, String, CGFloat)] = [
            ("name", "Profile", 200),
            ("auth", "Auth method", 190),
            ("access", "Access", 110),
            ("auto", "Auto-connect", 110),
            ("sync", "Sync", 120),
            ("cred", "Keychain", 90),
        ]
        for (id, title, width) in columns {
            let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(id))
            col.title = title
            col.width = width
            tableView.addTableColumn(col)
        }
    }

    @objc private func reload() {
        profiles = TerminalLaneProfileStore.shared.load()
        tableView.reloadData()
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = "\(profiles.count) profile\(profiles.count == 1 ? "" : "s")"
    }

    private func selectedProfile() -> TerminalLaneProfile? {
        let row = tableView.selectedRow
        guard row >= 0, row < profiles.count else { return nil }
        return profiles[row]
    }

    @objc private func editProfile() {
        guard let profile = selectedProfile() else {
            statusLabel.stringValue = "Select a profile to edit."
            return
        }
        // Hand off the id only — the editor reloads the full profile.
        TerminalLaneEditTarget.shared.profileId = profile.id
        NotificationCenter.default.post(name: .terminalLaneNavigate, object: TerminalLaneScreen.addProfile)
    }

    @objc private func duplicateProfile() {
        guard let original = selectedProfile() else {
            statusLabel.stringValue = "Select a profile to duplicate."
            return
        }
        var copy = original
        copy.id = uniqueId(basedOn: original.id)
        copy.displayName = original.displayName + " (copy)"
        copy.createdAt = TerminalLaneProfile.nowString()
        copy.updatedAt = TerminalLaneProfile.nowString()
        copy.lastSyncStatus = "not synced"
        // The Keychain item is keyed by host/user/port, so a duplicate keeps
        // using the same stored password; only the marker ref is re-derived.
        copy.credentialRef = original.authMethod == .password_keychain ? TerminalLaneProfile.derivedCredentialRef(profileId: copy.id) : nil
        do { try TerminalLaneProfileStore.shared.upsert(copy); reload() }
        catch { statusLabel.textColor = .systemRed; statusLabel.stringValue = error.localizedDescription }
    }

    @objc private func deleteProfile() {
        guard let profile = selectedProfile() else {
            statusLabel.stringValue = "Select a profile to delete."
            return
        }
        let alert = NSAlert()
        alert.messageText = "Delete profile “\(profile.displayName)”?"
        alert.informativeText = "This removes the profile locally and on HiveMatrix. The macOS Keychain secret, if any, is left for you to remove."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try TerminalLaneProfileStore.shared.delete(id: profile.id)
            TerminalLaneDaemonClient.shared.delete(profileId: profile.id) { _ in }
            reload()
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = error.localizedDescription
        }
    }

    private func uniqueId(basedOn id: String) -> String {
        let existing = Set(profiles.map(\.id))
        var candidate = "\(id)-copy"
        var n = 2
        while existing.contains(candidate) { candidate = "\(id)-copy-\(n)"; n += 1 }
        return candidate
    }

    // MARK: NSTableView

    func numberOfRows(in tableView: NSTableView) -> Int { profiles.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let profile = profiles[row]
        let text: String
        switch tableColumn?.identifier.rawValue {
        case "name": text = profile.displayName
        case "auth": text = profile.authMethod.label
        case "access": text = profile.accessMode.label
        case "auto": text = profile.autoConnect ? "Yes" : "Manual"
        case "sync": text = profile.lastSyncStatus
        case "cred":
            // Real Keychain presence for password profiles (attribute-only
            // lookup, never the secret) — not just the marker ref.
            if profile.authMethod == .password_keychain, let key = profile.keychainKey {
                text = TerminalLaneKeychain.shared.hasPassword(host: key.host, user: key.user, port: key.port) ? "✓" : "—"
            } else {
                text = profile.credentialPresent ? "✓" : "—"
            }
        default: text = ""
        }
        let cell = NSTextField(labelWithString: text)
        cell.lineBreakMode = .byTruncatingTail
        return cell
    }
}
