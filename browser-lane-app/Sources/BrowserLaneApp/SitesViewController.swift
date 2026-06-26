import AppKit

final class SitesViewController: NSViewController {
    private let stack = NSStackView()
    private let store = BrowserLaneSiteStore.shared

    override func loadView() {
        view = NSView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
        ])
        render()
    }

    private func render() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let title = NSTextField(labelWithString: "Sites")
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "Configured Browser Lane sites. Secrets live only in macOS Keychain.")
        subtitle.textColor = .secondaryLabelColor
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)

        let refresh = NSButton(title: "Refresh", target: self, action: #selector(refreshSites))
        stack.addArrangedSubview(refresh)

        let sites = store.listSites()
        if sites.isEmpty {
            let empty = NSTextField(labelWithString: "No sites configured yet. Use Add Site to register HeyGen or another authenticated site.")
            empty.textColor = .tertiaryLabelColor
            empty.lineBreakMode = .byWordWrapping
            empty.maximumNumberOfLines = 0
            stack.addArrangedSubview(empty)
            return
        }

        for site in sites {
            stack.addArrangedSubview(siteView(site))
        }
    }

    private func siteView(_ site: BrowserLaneSite) -> NSView {
        let box = NSBox()
        box.title = site.displayName
        box.boxType = .primary
        box.translatesAutoresizingMaskIntoConstraints = false

        let text = NSTextField(labelWithString:
            "\(site.id)\nHome: \(site.homeUrl)\nLogin: \(site.loginUrl)\nDomains: \(site.allowedDomains.joined(separator: ", "))\nCredential ref: \(site.credentialRef)\nSync: \(site.lastSyncStatus)"
        )
        text.lineBreakMode = .byWordWrapping
        text.maximumNumberOfLines = 0
        text.textColor = .secondaryLabelColor
        text.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(text)
        NSLayoutConstraint.activate([
            box.widthAnchor.constraint(greaterThanOrEqualToConstant: 560),
            text.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 12),
            text.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -12),
            text.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 10),
            text.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -10),
        ])
        return box
    }

    @objc private func refreshSites() {
        render()
    }
}
