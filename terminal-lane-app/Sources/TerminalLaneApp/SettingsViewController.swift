import AppKit

final class SettingsViewController: NSViewController {
    private let settings = TerminalLaneSettings.shared
    private let daemonURLField = NSTextField()
    private let statusLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Settings")
        title.font = .systemFont(ofSize: 34, weight: .bold)

        daemonURLField.stringValue = settings.daemonURL
        daemonURLField.placeholderString = "http://127.0.0.1:3747"

        let form = NSGridView(views: [
            [label("Daemon URL"), daemonURLField],
            [label("Auth token"), label(settings.tokenPath)],
            [label("Profiles"), label(settings.profileStorePath)],
            [label("Keychain items"), label("SSH passwords, one per user@host:port (Internet Password, label “\(TerminalLaneKeychain.labelPrefix)”)")],
        ])
        form.column(at: 0).xPlacement = .trailing
        form.column(at: 1).width = 540

        let save = NSButton(title: "Save settings", target: self, action: #selector(saveSettings))
        let buttons = NSStackView(views: [save, statusLabel])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let about = Bundle.main.infoDictionary ?? [:]
        let text = NSTextField(labelWithString:
            """
            Version: \(about["CFBundleShortVersionString"] as? String ?? "dev") (\(about["CFBundleVersion"] as? String ?? "0"))
            Bundle: \(about["CFBundleIdentifier"] as? String ?? "com.irvcassio.hivematrix.terminallane")
            """
        )
        text.font = .systemFont(ofSize: 14)
        let stack = NSStackView(views: [title, form, buttons, text])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func saveSettings() {
        settings.daemonURL = daemonURLField.stringValue
        daemonURLField.stringValue = settings.daemonURL
        statusLabel.stringValue = "Saved settings"
    }

    private func label(_ text: String) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.lineBreakMode = .byTruncatingMiddle
        return field
    }
}
