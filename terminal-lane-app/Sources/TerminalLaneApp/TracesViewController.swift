import AppKit

final class TracesViewController: NSViewController {
    private let textView = NSTextView()

    private let scroll = NSScrollView()

    override func loadView() {
        view = NSView()
        let title = TerminalLaneUI.largeTitle("Traces")
        textView.isEditable = false
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 12, height: 10)
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)

        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let card = NSBox()
        card.boxType = .custom
        card.titlePosition = .noTitle
        card.fillColor = .controlBackgroundColor
        card.borderColor = .separatorColor
        card.borderWidth = 1
        card.cornerRadius = 10
        card.contentViewMargins = .zero
        card.translatesAutoresizingMaskIntoConstraints = false
        let body = NSView()
        body.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
        ])
        card.contentView = body

        let refreshButton = TerminalLaneUI.secondaryButton("Refresh", target: self, action: #selector(refresh))
        let stack = NSStackView(views: [title, refreshButton, card])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: TerminalLaneUI.contentMargin),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: TerminalLaneUI.contentMargin),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -TerminalLaneUI.contentMargin),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -TerminalLaneUI.contentMargin),
            card.widthAnchor.constraint(equalTo: stack.widthAnchor),
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
