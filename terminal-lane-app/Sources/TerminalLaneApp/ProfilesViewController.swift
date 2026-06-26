import AppKit

final class ProfilesViewController: NSViewController {
    private let textView = NSTextView()

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Profiles")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        let refresh = NSButton(title: "Refresh", target: self, action: #selector(render))
        let stack = NSStackView(views: [title, refresh, textView])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -28),
        ])
        render()
    }

    @objc private func render() {
        textView.string = TerminalLaneProfileStore.shared.load().map { profile in
            "\(profile.id)  \(profile.kind.rawValue)  \(profile.openCommand)  \(profile.lastSyncStatus)"
        }.joined(separator: "\n")
    }
}
