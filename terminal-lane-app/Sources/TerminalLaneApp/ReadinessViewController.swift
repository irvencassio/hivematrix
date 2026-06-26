import AppKit

final class ReadinessViewController: NSViewController {
    private let textView = NSTextView()

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Readiness")
        title.font = .systemFont(ofSize: 34, weight: .bold)
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        let refresh = NSButton(title: "Refresh", target: self, action: #selector(refreshDashboard))
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
        refreshDashboard()
    }

    @objc private func refreshDashboard() {
        TerminalLaneDaemonClient.shared.fetchDashboard { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let profiles):
                    self?.textView.string = profiles.map { "\($0.color) \($0.displayName) \($0.status) \($0.summary)" }.joined(separator: "\n")
                case .failure(let error):
                    self?.textView.string = error.localizedDescription
                }
            }
        }
    }
}
