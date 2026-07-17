import AppKit

/// Per-site authentication readiness dashboard. Reads the daemon's
/// `/browser-lane/dashboard` aggregate and shows, honestly, which sites are ready,
/// need reauth, are stale/unknown, or blocked — plus the next action and the
/// buttons to act on it. No fabricated "green": a site with no real signal shows
/// gray/unknown, exactly as the daemon reports it.
final class ReadinessViewController: NSViewController {
    private let daemon = BrowserLaneDaemonClient.shared
    private let scrollView = NSScrollView()
    private let stack = NSStackView()
    private let statusLine = NSTextField(labelWithString: "Loading readiness…")
    /// The last-loaded site list, kept so button handlers (e.g. the saved-credential
    /// sign-in handoff) can look up a site's loginUrl/displayName by id.
    private var currentSites: [BrowserLaneDashboardSite] = []

    override func loadView() {
        view = NSView()

        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        let documentView = FlippedView()
        documentView.translatesAutoresizingMaskIntoConstraints = false
        documentView.addSubview(stack)
        scrollView.documentView = documentView
        view.addSubview(scrollView)

        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            scrollView.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -32),
            documentView.topAnchor.constraint(equalTo: scrollView.contentView.topAnchor),
            documentView.leadingAnchor.constraint(equalTo: scrollView.contentView.leadingAnchor),
            documentView.trailingAnchor.constraint(equalTo: scrollView.contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: documentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: documentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: documentView.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: documentView.bottomAnchor),
        ])

        reload()
    }

    @objc private func reload() {
        renderHeader(sites: nil, message: "Loading readiness…")
        daemon.fetchDashboard { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let sites):
                    self?.renderHeader(sites: sites, message: nil)
                case .failure(let error):
                    self?.renderHeader(sites: nil, message: "Daemon unreachable — \(error.localizedDescription). Start HiveMatrix to load readiness.")
                }
            }
        }
    }

    private func renderHeader(sites: [BrowserLaneDashboardSite]?, message: String?) {
        currentSites = sites ?? []
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let title = NSTextField(labelWithString: "Readiness")
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "Per-site authentication readiness. The COO only routes automation to sites that are green and fresh.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.lineBreakMode = .byWordWrapping
        subtitle.maximumNumberOfLines = 0

        let refresh = NSButton(title: "Refresh", target: self, action: #selector(reload))
        refresh.bezelStyle = .rounded

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(refresh)

        if let message {
            statusLine.stringValue = message
            statusLine.textColor = .secondaryLabelColor
            statusLine.lineBreakMode = .byWordWrapping
            statusLine.maximumNumberOfLines = 0
            stack.addArrangedSubview(statusLine)
            return
        }

        guard let sites, !sites.isEmpty else {
            let empty = NSTextField(labelWithString: "No sites configured yet. Add a site, then run readiness.")
            empty.textColor = .tertiaryLabelColor
            stack.addArrangedSubview(empty)
            return
        }

        for site in sites {
            stack.addArrangedSubview(siteCard(site))
        }
    }

    private func siteCard(_ site: BrowserLaneDashboardSite) -> NSView {
        let box = NSBox()
        box.title = "\(dot(for: site.color)) \(site.displayName) — \(site.statusLabel)"
        box.boxType = .primary
        box.translatesAutoresizingMaskIntoConstraints = false

        let info = NSTextField(labelWithString: [
            "\(capabilityGlyph(for: site)) Strategy: \(site.authStrategy)",
            site.providerAccount.flatMap { $0.isEmpty ? nil : "Account: \($0)" } ?? "Account: —",
            "Last checked: \(lastChecked(site))",
            "Next action: \(nextAction(for: site))",
            site.summary.isEmpty ? nil : "Summary: \(site.summary)",
        ].compactMap { $0 }.joined(separator: "\n"))
        info.lineBreakMode = .byWordWrapping
        info.maximumNumberOfLines = 0
        info.textColor = .secondaryLabelColor
        info.translatesAutoresizingMaskIntoConstraints = false

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 8
        buttons.translatesAutoresizingMaskIntoConstraints = false
        buttons.addArrangedSubview(actionButton("Open auth flow", site: site, action: #selector(openAuthFlow(_:))))
        if site.authStrategy == "keychain_password" {
            buttons.addArrangedSubview(actionButton("🔑 Sign in with saved credential", site: site, action: #selector(signInWithSavedCredential(_:))))
        }
        buttons.addArrangedSubview(actionButton("Run readiness", site: site, action: #selector(runReadiness(_:))))
        buttons.addArrangedSubview(actionButton("Mark needs reauth", site: site, action: #selector(markNeedsReauth(_:))))
        buttons.addArrangedSubview(actionButton("Refresh", site: site, action: #selector(reload)))

        let column = NSStackView(views: [info, buttons])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 10
        column.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(column)
        NSLayoutConstraint.activate([
            box.widthAnchor.constraint(greaterThanOrEqualToConstant: 620),
            column.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 12),
            column.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -12),
            column.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 10),
            column.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -10),
        ])
        return box
    }

    private func actionButton(_ title: String, site: BrowserLaneDashboardSite, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.identifier = NSUserInterfaceItemIdentifier(site.id)
        button.toolTip = site.loginUrl
        return button
    }

    private func siteId(_ sender: NSButton) -> String { sender.identifier?.rawValue ?? "" }

    @objc private func openAuthFlow(_ sender: NSButton) {
        guard let raw = sender.toolTip, let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else {
            statusLine.stringValue = "This site has no login / auth URL set."
            return
        }
        BrowserLaneNavigator.shared.openInBrowser(url)
    }

    @objc private func runReadiness(_ sender: NSButton) {
        let id = siteId(sender)
        daemon.runReadiness(siteId: id) { [weak self] _ in
            DispatchQueue.main.async { self?.reload() }
        }
    }

    @objc private func markNeedsReauth(_ sender: NSButton) {
        let id = siteId(sender)
        daemon.markReadiness(siteId: id, state: "needs_reauth", note: "Marked from Readiness dashboard") { [weak self] _ in
            DispatchQueue.main.async { self?.reload() }
        }
    }

    // Native Keychain read + clipboard handoff — the plaintext credential value
    // never leaves this process; only the site id crosses to the daemon, and only
    // for an audit record (see BrowserLaneDaemonClient.recordCredentialUse).
    /// Delegates to the shared sign-in path — the same one the sidebar's context
    /// menu uses. The dashboard row is display data; the sign-in needs the local
    /// site record (allowed domains, login steps), so look that up by id.
    @objc private func signInWithSavedCredential(_ sender: NSButton) {
        let id = siteId(sender)
        guard let site = BrowserLaneSiteStore.shared.listSites().first(where: { $0.id == id }) else { return }
        BrowserLaneSignIn.start(site: site)
    }

    // MARK: - Presentation helpers
    private func dot(for color: String) -> String {
        switch color {
        case "green":  return "🟢"
        case "orange": return "🟠"
        case "yellow": return "🟡"
        case "red":    return "🔴"
        default:       return "⚪️"
        }
    }

    /// Per-site capability glyph: green when this site can retrieve a saved
    /// sign-in natively (one click), yellow otherwise (SSO/manual — no
    /// stored credential to retrieve).
    private func capabilityGlyph(for site: BrowserLaneDashboardSite) -> String {
        site.authStrategy == "keychain_password" ? "🟢" : "🟡"
    }

    private func lastChecked(_ site: BrowserLaneDashboardSite) -> String {
        guard let last = site.lastRunAt, !last.isEmpty else { return "never" }
        return site.stale ? "\(last) (stale)" : last
    }

    private func nextAction(for site: BrowserLaneDashboardSite) -> String {
        switch site.color {
        case "green":
            return site.stale ? "Run readiness to confirm the session is still fresh." : "Ready — no action needed."
        case "orange":
            return "Open auth flow and complete sign-in (2FA/CAPTCHA), then run readiness."
        case "yellow":
            return "Run readiness to recheck — last probe was inconclusive or stale."
        case "red":
            return "Blocked — investigate the site before any automation runs."
        default:
            return "No readiness run yet — run readiness, or mark needs reauth after signing in."
        }
    }
}
