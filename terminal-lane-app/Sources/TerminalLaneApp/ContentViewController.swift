import AppKit

final class ContentViewController: NSViewController {
    override func loadView() {
        view = NSView()
        // Allow a screen (e.g. Profiles → Edit) to request navigation.
        NotificationCenter.default.addObserver(self, selector: #selector(handleNavigate(_:)), name: .terminalLaneNavigate, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func handleNavigate(_ note: Notification) {
        guard let screen = note.object as? TerminalLaneScreen else { return }
        show(screen)
    }

    func show(_ screen: TerminalLaneScreen) {
        let next: NSViewController
        switch screen {
        case .terminal: next = TerminalViewController()
        case .profiles: next = ProfilesViewController()
        case .addProfile: next = AddProfileViewController()
        case .readiness: next = ReadinessViewController()
        case .traces: next = TracesViewController()
        case .settings: next = SettingsViewController()
        }
        children.forEach { $0.removeFromParent() }
        view.subviews.forEach { $0.removeFromSuperview() }
        addChild(next)
        next.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(next.view)
        NSLayoutConstraint.activate([
            next.view.topAnchor.constraint(equalTo: view.topAnchor),
            next.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            next.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            next.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}
