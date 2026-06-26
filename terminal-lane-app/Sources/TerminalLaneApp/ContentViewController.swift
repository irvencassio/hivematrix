import AppKit

final class ContentViewController: NSViewController {
    override func loadView() {
        view = NSView()
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
