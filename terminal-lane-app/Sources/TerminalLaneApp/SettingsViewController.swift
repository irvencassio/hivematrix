import AppKit

final class SettingsViewController: NSViewController {
    private let settings = TerminalLaneSettings.shared
    private let daemonURLField = TerminalLaneUI.field(placeholder: "http://127.0.0.1:3747")
    private let statusLabel = TerminalLaneUI.statusPill()
    private let allowlistView = NSTextView()
    private let blocklistView = NSTextView()

    override func loadView() {
        view = NSView()
        let title = TerminalLaneUI.largeTitle("Settings")
        daemonURLField.stringValue = settings.daemonURL

        let daemonCard = TerminalLaneUI.card([
            TerminalLaneUI.row("Daemon URL", daemonURLField),
        ])
        let locationsCard = TerminalLaneUI.card([
            TerminalLaneUI.infoRow("Auth token", settings.tokenPath),
            TerminalLaneUI.infoRow("Profiles", settings.profileStorePath),
            TerminalLaneUI.infoRow("Keychain items", "SSH passwords, one per user@host:port"),
        ])

        let policy = TerminalLanePolicy.shared.policy
        let allowEditor = listEditor(allowlistView, seed: policy.readOnlyAllowlist)
        let blockEditor = listEditor(blocklistView, seed: policy.readWriteBlocklist)
        let allowSection = section("Read-only allowlist (one command per line)", allowEditor)
        let blockSection = section("Blocked everywhere (one command per line)", blockEditor)
        let viewLog = TerminalLaneUI.secondaryButton("View log", target: self, action: #selector(openLog))

        let save = TerminalLaneUI.primaryButton("Save settings", target: self, action: #selector(saveSettings))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [viewLog, spacer, statusLabel, save])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let about = Bundle.main.infoDictionary ?? [:]
        let aboutText = TerminalLaneUI.caption(
            "Version \(about["CFBundleShortVersionString"] as? String ?? "dev") (\(about["CFBundleVersion"] as? String ?? "0")) · \(about["CFBundleIdentifier"] as? String ?? "com.irvcassio.hivematrix.terminallane")\nKeychain items use the label “\(TerminalLaneKeychain.labelPrefix)” and are shared with other SSH tools on this Mac."
        )

        let stack = NSStackView(views: [
            title,
            section("Connection", daemonCard),
            section("Locations", locationsCard),
            allowSection,
            blockSection,
            buttons,
            aboutText,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: TerminalLaneUI.contentMargin),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: TerminalLaneUI.contentMargin),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -TerminalLaneUI.contentMargin),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 760),
            daemonCard.widthAnchor.constraint(equalTo: stack.widthAnchor),
            locationsCard.widthAnchor.constraint(equalTo: stack.widthAnchor),
            allowEditor.widthAnchor.constraint(equalTo: stack.widthAnchor),
            blockEditor.widthAnchor.constraint(equalTo: stack.widthAnchor),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    private func section(_ caption: String, _ card: NSView) -> NSStackView {
        let stack = NSStackView(views: [TerminalLaneUI.sectionCaption(caption), card])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        card.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        return stack
    }

    private func listEditor(_ view: NSTextView, seed: [String]) -> NSView {
        view.string = seed.joined(separator: "\n")
        view.isEditable = true
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textContainerInset = NSSize(width: 8, height: 8)
        let scroll = NSScrollView()
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: 120).isActive = true
        return scroll
    }

    @objc private func saveSettings() {
        settings.daemonURL = daemonURLField.stringValue
        daemonURLField.stringValue = settings.daemonURL
        let allow = allowlistView.string.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let block = blocklistView.string.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        TerminalLanePolicy.shared.update(readOnlyAllowlist: allow, readWriteBlocklist: block)
        statusLabel.textColor = .systemGreen
        statusLabel.stringValue = "Saved settings"
    }

    @objc private func openLog() {
        presentAsSheet(LogViewerController())
    }
}
