import AppKit

/// A site plus whatever the daemon last said about it. Readiness is enrichment:
/// the list renders from the local store even when the daemon is unreachable,
/// it just shows gray/unknown rather than an empty sidebar.
private struct SidebarSite {
    let site: BrowserLaneSite
    var color: String = "gray"
    var statusLabel: String = "Unknown"
    var stale: Bool = true
    /// The daemon's access mode, once the dashboard answers. nil = not heard yet.
    var daemonAccessMode: String?

    var sessionEstablished: Bool { BrowserLaneStatus.sessionEstablished(color: color, stale: stale) }

    /// The daemon enforces the gate, so its value wins. A local copy can diverge
    /// from it — `sync()` reports "saved locally; daemon sync failed" and keeps
    /// going — and a badge claiming read-only while the daemon still permits
    /// writes would be worse than no badge at all.
    var access: BrowserLaneAccessMode {
        daemonAccessMode.flatMap(BrowserLaneAccessMode.init(rawValue:)) ?? site.access
    }
}

/// The source list: configured sites, each with a session dot, plus "+" to add.
/// This is the app's primary navigation — sites, not screens. Settings/readiness
/// live in the window toolbar.
final class SidebarViewController: NSViewController {
    /// A site row was activated — open it in the browser.
    var onSelectSite: ((BrowserLaneSite) -> Void)?
    /// Show the Command Log scoped to this site.
    var onViewLog: ((BrowserLaneSite) -> Void)?
    /// "+" / context-menu New Site.
    var onAddSite: (() -> Void)?

    private let daemon = BrowserLaneDaemonClient.shared
    private var rows: [SidebarSite] = []
    private var tableView: NSTableView!
    private let emptyLabel = NSTextField(labelWithString: "No sites added yet.")

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 640))

        let header = NSTextField(labelWithString: "Sites")
        header.font = .systemFont(ofSize: 13, weight: .semibold)
        header.translatesAutoresizingMaskIntoConstraints = false

        let addButton = NSButton(
            image: NSImage(systemSymbolName: "plus", accessibilityDescription: "Add site") ?? NSImage(),
            target: self,
            action: #selector(addSiteTapped)
        )
        addButton.isBordered = false
        addButton.bezelStyle = .inline
        addButton.contentTintColor = .secondaryLabelColor
        addButton.toolTip = "Add site"
        addButton.setAccessibilityLabel("Add site")
        addButton.translatesAutoresizingMaskIntoConstraints = false

        let divider = NSBox()
        divider.boxType = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false

        tableView = NSTableView()
        tableView.headerView = nil
        tableView.style = .sourceList
        tableView.rowHeight = 40
        tableView.intercellSpacing = NSSize(width: 0, height: 2)
        tableView.delegate = self
        tableView.dataSource = self
        tableView.target = self
        tableView.doubleAction = #selector(rowDoubleClicked)
        tableView.menu = buildContextMenu()
        let col = NSTableColumn(identifier: .init("site"))
        col.isEditable = false
        tableView.addTableColumn(col)

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false

        emptyLabel.font = .systemFont(ofSize: 11)
        emptyLabel.textColor = .secondaryLabelColor
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(header)
        view.addSubview(addButton)
        view.addSubview(divider)
        view.addSubview(scroll)
        view.addSubview(emptyLabel)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            header.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
            addButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            addButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            addButton.widthAnchor.constraint(equalToConstant: 20),

            divider.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            scroll.topAnchor.constraint(equalTo: divider.bottomAnchor, constant: 4),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            emptyLabel.topAnchor.constraint(equalTo: divider.bottomAnchor, constant: 12),
            emptyLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            emptyLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -12),
        ])

        NotificationCenter.default.addObserver(
            self, selector: #selector(reload), name: .browserLaneSitesChanged, object: nil
        )
        reload()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // MARK: - Data

    /// Renders local sites immediately, then folds in daemon readiness when it
    /// answers. A daemon that is down degrades the dots, never the list.
    @objc func reload() {
        let sites = BrowserLaneSiteStore.shared.listSites()
        let selectedId = selectedSite()?.id
        rows = sites.map { SidebarSite(site: $0) }
        applyRows(restoring: selectedId)

        daemon.fetchDashboard { [weak self] result in
            guard let self, case .success(let dashboard) = result else { return }
            DispatchQueue.main.async {
                let byId = Dictionary(uniqueKeysWithValues: dashboard.map { ($0.id, $0) })
                self.rows = self.rows.map { row in
                    guard let d = byId[row.site.id] else { return row }
                    var enriched = row
                    enriched.color = d.color
                    enriched.statusLabel = d.statusLabel
                    enriched.stale = d.stale
                    enriched.daemonAccessMode = d.accessMode
                    return enriched
                }
                self.applyRows(restoring: selectedId)
            }
        }
    }

    private func applyRows(restoring selectedId: String?) {
        emptyLabel.isHidden = !rows.isEmpty
        tableView.reloadData()
        if let selectedId, let index = rows.firstIndex(where: { $0.site.id == selectedId }) {
            tableView.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        }
    }

    private func selectedSite() -> BrowserLaneSite? {
        let row = tableView.selectedRow
        guard row >= 0, row < rows.count else { return nil }
        return rows[row].site
    }

    /// The row a context-menu action applies to: the right-clicked row when there
    /// is one, else the selection. Without this, right-clicking a non-selected row
    /// would silently act on a different site.
    private func targetSite() -> BrowserLaneSite? {
        let clicked = tableView.clickedRow
        if clicked >= 0 && clicked < rows.count { return rows[clicked].site }
        return selectedSite()
    }

    // MARK: - Actions

    @objc private func addSiteTapped() { onAddSite?() }

    @objc private func rowDoubleClicked() {
        guard let site = targetSite() else { return }
        onSelectSite?(site)
    }

    private func buildContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open", action: #selector(menuOpen), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Sign in with saved credential", action: #selector(menuSignIn), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Run Readiness Check", action: #selector(menuRunReadiness), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Edit…", action: #selector(menuEdit), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Duplicate", action: #selector(menuDuplicate), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "View Command Log", action: #selector(menuViewLog), keyEquivalent: ""))
        menu.addItem(.separator())
        let delete = NSMenuItem(title: "Delete", action: #selector(menuDelete), keyEquivalent: "")
        menu.addItem(delete)
        for item in menu.items { item.target = self }
        return menu
    }

    @objc private func menuOpen() {
        guard let site = targetSite() else { return }
        onSelectSite?(site)
    }

    @objc private func menuViewLog() {
        guard let site = targetSite() else { return }
        onViewLog?(site)
    }

    /// Same shared path the Readiness card's button uses — an explicit click, and
    /// exactly one implementation of the credential flow.
    @objc private func menuSignIn() {
        guard let site = targetSite() else { return }
        BrowserLaneSignIn.start(site: site)
    }

    @objc private func menuEdit() {
        guard let site = targetSite() else { return }
        BrowserLaneEditTarget.shared.siteId = site.id
        NotificationCenter.default.post(name: .browserLaneNavigate, object: Screen.addSite)
    }

    @objc private func menuRunReadiness() {
        guard let site = targetSite() else { return }
        daemon.runReadiness(siteId: site.id) { [weak self] _ in
            DispatchQueue.main.async { self?.reload() }
        }
    }

    /// Copies the site's settings only. The duplicate gets a fresh id and its own
    /// credential reference — it never points at the original's Keychain entry, so
    /// deleting one cannot pull the sign-in out from under the other.
    @objc private func menuDuplicate() {
        guard let site = targetSite() else { return }
        var copy = site
        let baseId = browserLaneSlug("\(site.id)-copy")
        var candidate = baseId
        var n = 2
        let existing = Set(BrowserLaneSiteStore.shared.listSites().map(\.id))
        while existing.contains(candidate) {
            candidate = "\(baseId)-\(n)"
            n += 1
        }
        copy.id = candidate
        copy.displayName = "\(site.displayName) copy"
        copy.credentialRef = "hivematrix.browser.\(candidate).primary"
        copy.lastSyncStatus = "not synced"
        copy.createdAt = BrowserLaneSite.nowString()
        copy.updatedAt = BrowserLaneSite.nowString()
        do {
            try BrowserLaneSiteStore.shared.upsert(copy)
        } catch {
            presentError("Could not duplicate “\(site.displayName)”.", error.localizedDescription)
        }
    }

    @objc private func menuDelete() {
        guard let site = targetSite() else { return }
        let alert = NSAlert()
        alert.messageText = "Delete “\(site.displayName)”?"
        alert.informativeText = site.strategy.usesKeychainPassword
            ? "This removes the site and its saved sign-in from your Keychain. This cannot be undone."
            : "This removes the site from Browser Lane. This cannot be undone."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        do {
            try BrowserLaneSiteStore.shared.delete(id: site.id)
            BrowserLaneKeychain.shared.deleteCredential(siteId: site.id)
        } catch {
            presentError("Could not delete “\(site.displayName)”.", error.localizedDescription)
        }
    }

    private func presentError(_ message: String, _ detail: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.runModal()
    }
}

extension SidebarViewController: NSTableViewDataSource {
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
}

extension SidebarViewController: NSMenuItemValidation {
    /// Google/Microsoft SSO and manual-session sites have no stored sign-in to
    /// retrieve, so the item greys out rather than offering an action that can
    /// only fail. Everything else stays enabled.
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard menuItem.action == #selector(menuSignIn) else { return true }
        guard let site = targetSite() else { return false }
        return BrowserLaneSignIn.isAvailable(for: site)
    }
}

extension SidebarViewController: NSTableViewDelegate {
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = SiteRowCell()
        cell.configure(rows[row])
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard let site = selectedSite() else { return }
        onSelectSite?(site)
    }
}

/// Canopy's ServerRow: globe + session dot, name over subtitle, access badge.
/// NSTableCellView (not a bare NSView) so AppKit inverts our text for us when the
/// row is selected — hand-rolled colors would stay dark-on-blue.
private final class SiteRowCell: NSTableCellView {
    private let icon = NSImageView()
    private let dot = StatusDotView()
    private let name = NSTextField(labelWithString: "")
    private let subtitle = NSTextField(labelWithString: "")
    private let badge = NSImageView()

    init() {
        super.init(frame: .zero)

        icon.image = NSImage(systemSymbolName: "globe", accessibilityDescription: nil)
        icon.contentTintColor = .secondaryLabelColor
        icon.translatesAutoresizingMaskIntoConstraints = false

        name.font = .systemFont(ofSize: 13, weight: .medium)
        name.lineBreakMode = .byTruncatingTail
        name.translatesAutoresizingMaskIntoConstraints = false

        subtitle.font = .systemFont(ofSize: 10)
        subtitle.textColor = .secondaryLabelColor
        subtitle.lineBreakMode = .byTruncatingMiddle
        subtitle.translatesAutoresizingMaskIntoConstraints = false

        badge.translatesAutoresizingMaskIntoConstraints = false

        addSubview(icon)
        addSubview(dot)
        addSubview(name)
        addSubview(subtitle)
        addSubview(badge)
        textField = name

        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 18),
            icon.heightAnchor.constraint(equalToConstant: 18),

            // Bottom-trailing of the icon, like Canopy's connection dot.
            dot.trailingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 3),
            dot.bottomAnchor.constraint(equalTo: icon.bottomAnchor, constant: 2),

            name.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10),
            name.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            name.trailingAnchor.constraint(lessThanOrEqualTo: badge.leadingAnchor, constant: -6),

            subtitle.leadingAnchor.constraint(equalTo: name.leadingAnchor),
            subtitle.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 1),
            subtitle.trailingAnchor.constraint(lessThanOrEqualTo: badge.leadingAnchor, constant: -6),

            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            badge.centerYAnchor.constraint(equalTo: centerYAnchor),
            badge.widthAnchor.constraint(equalToConstant: 12),
            badge.heightAnchor.constraint(equalToConstant: 12),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func configure(_ row: SidebarSite) {
        let site = row.site
        name.stringValue = site.displayName.isEmpty ? site.id : site.displayName

        // Prefer the account we sign in as; fall back to the domain.
        let account = site.providerAccount ?? ""
        subtitle.stringValue = account.isEmpty ? site.primaryDomain : account

        dot.apply(daemonColor: row.color, stale: row.stale)
        dot.isHidden = row.color == "gray" && row.stale

        let access = row.access
        badge.image = NSImage(systemSymbolName: access.symbol, accessibilityDescription: access.label)
        badge.contentTintColor = access.tint
        badge.toolTip = access.help

        toolTip = row.sessionEstablished
            ? "\(row.statusLabel) — signed in as of the last check"
            : row.statusLabel
    }
}
