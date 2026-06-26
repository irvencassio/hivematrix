import AppKit

final class TracesViewController: NSViewController {
    private let textView = NSTextView()

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Traces")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        let refreshButton = NSButton(title: "Refresh", target: self, action: #selector(refresh))
        let stack = NSStackView(views: [title, refreshButton, textView])
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
        refresh()
    }

    @objc private func refresh() {
        TerminalLaneDaemonClient.shared.fetchTraces { [weak self] result in
            DispatchQueue.main.async {
                self?.textView.string = (try? result.get()) ?? "No traces yet."
            }
        }
    }
}
