import AppKit

final class SidebarViewController: NSViewController {
    var onSelect: ((TerminalLaneScreen) -> Void)?
    private var buttons: [TerminalLaneScreen: NSButton] = [:]

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
        ])
        for screen in TerminalLaneScreen.allCases {
            let button = NSButton(title: screen.title, target: self, action: #selector(selectScreen(_:)))
            button.bezelStyle = .texturedRounded
            button.identifier = NSUserInterfaceItemIdentifier(screen.rawValue)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.widthAnchor.constraint(equalToConstant: 160).isActive = true
            stack.addArrangedSubview(button)
            buttons[screen] = button
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        onSelect?(.terminal)
    }

    @objc private func selectScreen(_ sender: NSButton) {
        guard let raw = sender.identifier?.rawValue, let screen = TerminalLaneScreen(rawValue: raw) else { return }
        onSelect?(screen)
    }
}
