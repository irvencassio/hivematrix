import AppKit

/// Command Log filters. Each one maps to a signal Browser Lane actually emits —
/// `actorKind` for Human/Agent, and the three `browser:*` statuses/events that
/// exist today. Canopy also shows a "Warned" chip; Browser Lane has no warn path
/// (the access-mode gate blocks outright), so a Warned chip here would always be
/// empty and is deliberately absent.
private enum LogFilter: String, CaseIterable {
    case human = "Human"
    case agent = "Agent"
    case blocked = "Blocked"
    case failed = "Failed"
    case security = "Security"

    func matches(_ entry: BrowserLaneHistoryEntry) -> Bool {
        switch self {
        case .human:    return entry.actorKind == "human"
        case .agent:    return entry.actorKind == "agent"
        case .blocked:  return entry.status == "blocked"
        case .failed:   return entry.status == "failed"
        // Credential retrieval is the security-relevant event on this lane.
        case .security: return entry.event == "browser:credential_fill"
        }
    }
}

/// The right panel: `browser:*` audit history for one site (or all sites), with
/// actor/status chips and search. Read-only — it renders what the daemon already
/// recorded and never mutates anything.
final class HistoryPanelViewController: NSViewController {
    private let daemon = BrowserLaneDaemonClient.shared
    private var entries: [BrowserLaneHistoryEntry] = []
    private var activeFilters: Set<LogFilter> = []
    private var searchText = ""
    private var site: BrowserLaneSite?

    private let titleLabel = NSTextField(labelWithString: "Command Log")
    private let statusLabel = NSTextField(labelWithString: "")
    private let searchField = NSSearchField()
    private var chipButtons: [LogFilter: NSButton] = [:]
    private var tableView: NSTableView!

    /// Filtered in memory, like Canopy's `filteredEntries`: one fetch, instant
    /// chip toggling. No active chip means no filter, not "hide everything".
    private var filteredEntries: [BrowserLaneHistoryEntry] {
        var result = entries
        if !activeFilters.isEmpty {
            result = result.filter { entry in activeFilters.contains { $0.matches(entry) } }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.target.localizedCaseInsensitiveContains(searchText)
                    || $0.summary.localizedCaseInsensitiveContains(searchText)
                    || $0.badge.localizedCaseInsensitiveContains(searchText)
                    || $0.actor.localizedCaseInsensitiveContains(searchText)
            }
        }
        return result
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 640))

        let headerIcon = NSImageView()
        headerIcon.image = NSImage(systemSymbolName: "doc.text.magnifyingglass", accessibilityDescription: nil)
        headerIcon.contentTintColor = .secondaryLabelColor
        headerIcon.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let refresh = NSButton(
            image: NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "Refresh log") ?? NSImage(),
            target: self, action: #selector(reload)
        )
        refresh.isBordered = false
        refresh.bezelStyle = .inline
        refresh.contentTintColor = .secondaryLabelColor
        refresh.toolTip = "Refresh log"
        refresh.translatesAutoresizingMaskIntoConstraints = false

        let chipStack = NSStackView()
        chipStack.orientation = .horizontal
        chipStack.spacing = 10
        chipStack.translatesAutoresizingMaskIntoConstraints = false
        for filter in LogFilter.allCases {
            let button = NSButton(title: filter.rawValue, target: self, action: #selector(chipToggled(_:)))
            button.isBordered = false
            button.setButtonType(.momentaryChange)
            button.font = .systemFont(ofSize: 11, weight: .medium)
            button.contentTintColor = .secondaryLabelColor
            button.toolTip = "Show only \(filter.rawValue.lowercased()) entries"
            chipButtons[filter] = button
            chipStack.addArrangedSubview(button)
        }

        searchField.placeholderString = "Search"
        searchField.target = self
        searchField.action = #selector(searchChanged)
        searchField.sendsWholeSearchString = false
        searchField.sendsSearchStringImmediately = true
        searchField.translatesAutoresizingMaskIntoConstraints = false

        tableView = NSTableView()
        tableView.headerView = nil
        tableView.style = .plain
        tableView.rowHeight = 44
        tableView.backgroundColor = .clear
        tableView.delegate = self
        tableView.dataSource = self
        let col = NSTableColumn(identifier: .init("entry"))
        col.isEditable = false
        tableView.addTableColumn(col)

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        let divider = NSBox()
        divider.boxType = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(headerIcon)
        view.addSubview(titleLabel)
        view.addSubview(refresh)
        view.addSubview(chipStack)
        view.addSubview(searchField)
        view.addSubview(divider)
        view.addSubview(scroll)
        view.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            headerIcon.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            headerIcon.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
            headerIcon.widthAnchor.constraint(equalToConstant: 16),
            headerIcon.heightAnchor.constraint(equalToConstant: 16),

            titleLabel.leadingAnchor.constraint(equalTo: headerIcon.trailingAnchor, constant: 8),
            titleLabel.centerYAnchor.constraint(equalTo: headerIcon.centerYAnchor),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: refresh.leadingAnchor, constant: -8),

            refresh.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            refresh.centerYAnchor.constraint(equalTo: headerIcon.centerYAnchor),
            refresh.widthAnchor.constraint(equalToConstant: 20),

            chipStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            chipStack.topAnchor.constraint(equalTo: headerIcon.bottomAnchor, constant: 10),

            searchField.leadingAnchor.constraint(greaterThanOrEqualTo: chipStack.trailingAnchor, constant: 12),
            searchField.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            searchField.centerYAnchor.constraint(equalTo: chipStack.centerYAnchor),
            searchField.widthAnchor.constraint(greaterThanOrEqualToConstant: 120),

            divider.topAnchor.constraint(equalTo: chipStack.bottomAnchor, constant: 8),
            divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            scroll.topAnchor.constraint(equalTo: divider.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -6),

            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -12),
            statusLabel.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
        ])

        refreshChipStyles()
        reload()
    }

    /// Scope the log to one site. Passing nil shows every site's activity.
    func show(site: BrowserLaneSite?) {
        self.site = site
        titleLabel.stringValue = site.map { "\($0.displayName) — Command Log" } ?? "All Sites — Command Log"
        reload()
    }

    @objc private func reload() {
        guard isViewLoaded else { return }
        statusLabel.stringValue = "Loading…"
        daemon.fetchHistory(target: site?.id, limit: 200) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let entries):
                    self.entries = entries
                    self.tableView.reloadData()
                    self.updateStatus()
                case .failure(let error):
                    self.entries = []
                    self.tableView.reloadData()
                    // Say the log is unavailable rather than showing an empty list
                    // that reads as "nothing ever happened".
                    self.statusLabel.stringValue = "Log unavailable — \(error.localizedDescription)"
                }
            }
        }
    }

    private func updateStatus() {
        let shown = filteredEntries.count
        if entries.isEmpty {
            statusLabel.stringValue = "No activity recorded yet"
        } else if shown == entries.count {
            statusLabel.stringValue = "\(shown) event\(shown == 1 ? "" : "s")"
        } else {
            statusLabel.stringValue = "\(shown) of \(entries.count) events"
        }
    }

    @objc private func chipToggled(_ sender: NSButton) {
        guard let filter = chipButtons.first(where: { $0.value === sender })?.key else { return }
        if activeFilters.contains(filter) { activeFilters.remove(filter) } else { activeFilters.insert(filter) }
        refreshChipStyles()
        tableView.reloadData()
        updateStatus()
    }

    private func refreshChipStyles() {
        for (filter, button) in chipButtons {
            let active = activeFilters.contains(filter)
            button.contentTintColor = active ? .controlAccentColor : .secondaryLabelColor
            button.attributedTitle = NSAttributedString(
                string: filter.rawValue,
                attributes: [
                    .font: NSFont.systemFont(ofSize: 11, weight: active ? .semibold : .medium),
                    .foregroundColor: active ? NSColor.controlAccentColor : NSColor.secondaryLabelColor,
                ]
            )
        }
    }

    @objc private func searchChanged() {
        searchText = searchField.stringValue.trimmingCharacters(in: .whitespaces)
        tableView.reloadData()
        updateStatus()
    }
}

extension HistoryPanelViewController: NSTableViewDataSource {
    func numberOfRows(in tableView: NSTableView) -> Int { filteredEntries.count }
}

extension HistoryPanelViewController: NSTableViewDelegate {
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = LogRowCell()
        cell.configure(filteredEntries[row])
        return cell
    }
}

/// One log row: accent bar, actor glyph, time, event badge, then the target.
private final class LogRowCell: NSView {
    private let accentBar = NSView()
    private let glyph = NSImageView()
    private let time = NSTextField(labelWithString: "")
    private let badge = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f
    }()

    init() {
        super.init(frame: .zero)
        wantsLayer = true

        accentBar.wantsLayer = true
        accentBar.translatesAutoresizingMaskIntoConstraints = false

        glyph.translatesAutoresizingMaskIntoConstraints = false

        time.font = .systemFont(ofSize: 11, weight: .medium)
        time.textColor = .secondaryLabelColor
        time.translatesAutoresizingMaskIntoConstraints = false

        badge.font = .systemFont(ofSize: 9, weight: .medium)
        badge.textColor = .secondaryLabelColor
        badge.wantsLayer = true
        badge.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.25).cgColor
        badge.layer?.cornerRadius = 3
        badge.translatesAutoresizingMaskIntoConstraints = false

        detail.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        detail.lineBreakMode = .byTruncatingMiddle
        detail.translatesAutoresizingMaskIntoConstraints = false

        addSubview(accentBar)
        addSubview(glyph)
        addSubview(time)
        addSubview(badge)
        addSubview(detail)

        NSLayoutConstraint.activate([
            accentBar.leadingAnchor.constraint(equalTo: leadingAnchor),
            accentBar.topAnchor.constraint(equalTo: topAnchor, constant: 2),
            accentBar.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -2),
            accentBar.widthAnchor.constraint(equalToConstant: 3),

            glyph.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            glyph.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            glyph.widthAnchor.constraint(equalToConstant: 12),
            glyph.heightAnchor.constraint(equalToConstant: 12),

            time.leadingAnchor.constraint(equalTo: glyph.trailingAnchor, constant: 6),
            time.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),

            badge.leadingAnchor.constraint(equalTo: time.trailingAnchor, constant: 8),
            badge.centerYAnchor.constraint(equalTo: time.centerYAnchor),
            badge.heightAnchor.constraint(equalToConstant: 14),
            badge.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -12),

            detail.leadingAnchor.constraint(equalTo: glyph.leadingAnchor),
            detail.topAnchor.constraint(equalTo: glyph.bottomAnchor, constant: 4),
            detail.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -12),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func configure(_ entry: BrowserLaneHistoryEntry) {
        time.stringValue = entry.date.map { Self.timeFormatter.string(from: $0) } ?? "—"
        badge.stringValue = " \(entry.badge) "

        // Canopy color-codes the actor: agents green, humans blue.
        let actorColor: NSColor = entry.isAgent ? .systemGreen : .systemBlue
        glyph.image = NSImage(
            systemSymbolName: entry.isAgent ? "cpu" : "person.fill",
            accessibilityDescription: entry.isAgent ? "Agent" : "Human"
        )
        glyph.contentTintColor = actorColor

        // A refusal or failure gets the left accent bar so it is findable by eye.
        switch entry.status {
        case "blocked": accentBar.layer?.backgroundColor = NSColor.systemRed.cgColor
        case "failed":  accentBar.layer?.backgroundColor = NSColor.systemOrange.cgColor
        default:        accentBar.layer?.backgroundColor = NSColor.clear.cgColor
        }

        let target = entry.target.isEmpty ? "—" : entry.target
        detail.stringValue = entry.summary.isEmpty ? target : "\(target) · \(entry.summary)"
        toolTip = "\(entry.actor) · \(entry.event)\(entry.status.isEmpty ? "" : " · \(entry.status)")"
    }
}
