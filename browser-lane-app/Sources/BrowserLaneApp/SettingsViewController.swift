import AppKit

final class SettingsViewController: NSViewController {
    private let settings = BrowserLaneSettings.shared
    private let iconPopup = NSPopUpButton()
    private let defaultURLField = NSTextField()
    private let daemonURLField = NSTextField()
    private let statusLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Settings")
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(sectionTitle("Appearance"))

        iconPopup.addItems(withTitles: BrowserLaneIconState.allCases.map(\.label))
        iconPopup.selectItem(withTitle: settings.iconState.label)
        iconPopup.target = self
        iconPopup.action = #selector(iconStateChanged)
        stack.addArrangedSubview(row("Icon state", iconPopup))

        stack.addArrangedSubview(sectionTitle("Browser"))
        defaultURLField.stringValue = settings.defaultURL
        defaultURLField.placeholderString = "https://www.google.com"
        stack.addArrangedSubview(row("Default URL", defaultURLField))

        stack.addArrangedSubview(sectionTitle("Daemon"))
        daemonURLField.stringValue = settings.daemonURL
        stack.addArrangedSubview(row("Daemon URL", daemonURLField))
        stack.addArrangedSubview(info("Token path", settings.tokenPath))

        stack.addArrangedSubview(sectionTitle("Storage"))
        stack.addArrangedSubview(info("Site metadata", settings.siteMetadataPath))
        stack.addArrangedSubview(info("Keychain service", BrowserLaneKeychain.service))

        stack.addArrangedSubview(sectionTitle("About"))
        let bundle = Bundle.main
        let name = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Browser Lane"
        let identifier = bundle.bundleIdentifier ?? (bundle.object(forInfoDictionaryKey: "CFBundleIdentifier") as? String ?? "unknown")
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "local"
        stack.addArrangedSubview(info("App", name))
        stack.addArrangedSubview(info("Bundle", identifier))
        stack.addArrangedSubview(info("Version", "\(version) (\(build))"))

        let saveButton = NSButton(title: "Save settings", target: self, action: #selector(saveSettings))
        stack.addArrangedSubview(saveButton)
        statusLabel.textColor = .secondaryLabelColor
        stack.addArrangedSubview(statusLabel)

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
        ])
    }

    private func sectionTitle(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        return label
    }

    private func row(_ label: String, _ control: NSView) -> NSView {
        let labelView = NSTextField(labelWithString: label)
        labelView.textColor = .secondaryLabelColor
        let row = NSStackView(views: [labelView, control])
        row.orientation = .horizontal
        row.spacing = 12
        labelView.widthAnchor.constraint(equalToConstant: 110).isActive = true
        control.widthAnchor.constraint(greaterThanOrEqualToConstant: 360).isActive = true
        return row
    }

    private func info(_ label: String, _ value: String) -> NSView {
        let valueLabel = NSTextField(labelWithString: value)
        valueLabel.textColor = .secondaryLabelColor
        valueLabel.lineBreakMode = .byTruncatingMiddle
        return row(label, valueLabel)
    }

    @objc private func iconStateChanged() {
        let index = iconPopup.indexOfSelectedItem
        guard BrowserLaneIconState.allCases.indices.contains(index) else { return }
        settings.iconState = BrowserLaneIconState.allCases[index]
        statusLabel.stringValue = "Icon state applied."
    }

    @objc private func saveSettings() {
        settings.defaultURL = defaultURLField.stringValue
        settings.daemonURL = daemonURLField.stringValue
        settings.applyIconState()
        statusLabel.stringValue = "Settings saved."
    }
}
