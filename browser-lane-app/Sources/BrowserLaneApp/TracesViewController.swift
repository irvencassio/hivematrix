import AppKit

final class TracesViewController: NSViewController {
    private let daemon = BrowserLaneDaemonClient.shared
    private let textView = NSTextView()
    private let statusLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()

        let title = NSTextField(labelWithString: "Traces")
        title.font = .systemFont(ofSize: 28, weight: .semibold)

        let subtitle = NSTextField(labelWithString: "Browser Lane trace runs from HiveMatrix. Values are redacted by the daemon before they reach this app.")
        subtitle.textColor = .secondaryLabelColor
        subtitle.lineBreakMode = .byWordWrapping
        subtitle.maximumNumberOfLines = 0

        let latest = NSButton(title: "Latest trace", target: self, action: #selector(loadLatestTrace))
        let refresh = NSButton(title: "Refresh traces", target: self, action: #selector(loadTraceList))
        let buttons = NSStackView(views: [latest, refresh, statusLabel])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.string = "Loading traces..."

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = textView
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [title, subtitle, buttons, scroll])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -32),
            scroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 720),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 520),
        ])

        loadLatestTrace()
    }

    @objc private func loadLatestTrace() {
        statusLabel.stringValue = "Loading latest..."
        daemon.fetchLatestTrace { [weak self] result in
            DispatchQueue.main.async { self?.render(result, fallbackTitle: "No latest trace yet.") }
        }
    }

    @objc private func loadTraceList() {
        statusLabel.stringValue = "Loading traces..."
        daemon.fetchTraces { [weak self] result in
            DispatchQueue.main.async { self?.render(result, fallbackTitle: "No traces yet.") }
        }
    }

    private func render(_ result: Result<String, Error>, fallbackTitle: String) {
        switch result {
        case .success(let text):
            statusLabel.stringValue = "Loaded."
            textView.string = text.isEmpty ? fallbackTitle : text
        case .failure(let error):
            statusLabel.stringValue = "Trace load failed."
            textView.string = error.localizedDescription
        }
    }
}
