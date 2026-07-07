import AppKit

/// A scrollable, read-only viewer for the rolling command log (newest first).
final class LogViewerController: NSViewController {
    private let textView = NSTextView()

    override func loadView() {
        view = NSView()
        view.setFrameSize(NSSize(width: 760, height: 520))
        let title = TerminalLaneUI.largeTitle("Command Log")
        textView.isEditable = false
        textView.drawsBackground = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textContainerInset = NSSize(width: 10, height: 10)

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let refresh = TerminalLaneUI.secondaryButton("Refresh", target: self, action: #selector(reload))
        let reveal = TerminalLaneUI.secondaryButton("Reveal in Finder", target: self, action: #selector(reveal))
        let close = TerminalLaneUI.primaryButton("Done", target: self, action: #selector(done))
        let spacer = NSView(); spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [refresh, reveal, spacer, close])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [title, scroll, buttons])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        reload()
    }

    @objc private func reload() {
        let text = TerminalLanePolicy.shared.log.recentText()
        textView.string = text.isEmpty ? "No commands logged yet." : text
    }

    @objc private func reveal() {
        NSWorkspace.shared.activateFileViewerSelecting([TerminalLanePaths.logsDir])
    }

    @objc private func done() {
        presentingViewController?.dismiss(self)
    }
}
