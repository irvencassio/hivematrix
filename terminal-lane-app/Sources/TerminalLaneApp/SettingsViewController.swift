import AppKit

final class SettingsViewController: NSViewController {
    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Settings")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        let about = Bundle.main.infoDictionary ?? [:]
        let text = NSTextField(labelWithString:
            """
            Daemon: http://127.0.0.1:3747
            Storage: ~/Library/Application Support/Terminal Lane/profiles.json
            Keychain service: HiveMatrix Terminal Lane

            Version: \(about["CFBundleShortVersionString"] as? String ?? "dev") (\(about["CFBundleVersion"] as? String ?? "0"))
            Bundle: \(about["CFBundleIdentifier"] as? String ?? "com.irvcassio.hivematrix.terminallane")
            """
        )
        text.font = .systemFont(ofSize: 14)
        let stack = NSStackView(views: [title, text])
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
}
