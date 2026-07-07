import AppKit

final class SettingsViewController: NSViewController {
    private let settings = TerminalLaneSettings.shared
    private let daemonURLField = TerminalLaneUI.field(placeholder: "http://127.0.0.1:3747")
    private let statusLabel = TerminalLaneUI.statusPill()

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

        let save = TerminalLaneUI.primaryButton("Save settings", target: self, action: #selector(saveSettings))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [spacer, statusLabel, save])
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

    @objc private func saveSettings() {
        settings.daemonURL = daemonURLField.stringValue
        daemonURLField.stringValue = settings.daemonURL
        statusLabel.textColor = .systemGreen
        statusLabel.stringValue = "Saved settings"
    }
}
