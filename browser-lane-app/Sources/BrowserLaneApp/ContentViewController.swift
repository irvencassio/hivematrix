import AppKit

final class ContentViewController: NSViewController {
    private var currentChild: NSViewController?

    /// Which screen is showing. The toolbar reads this to light the matching icon
    /// and to decide whether a second click should return to the browser.
    private(set) var currentScreen: Screen = .browser
    var onScreenChanged: (() -> Void)?

    override func loadView() {
        view = NSView()
        // Any screen can hand a URL to the persistent in-app browser (SSO handoff).
        BrowserLaneNavigator.shared.openHandler = { [weak self] url in
            BrowserLaneNavigator.shared.pendingURL = url
            self?.show(.browser)
        }
        // A screen (e.g. Sites → Edit) can request navigation to another screen.
        NotificationCenter.default.addObserver(self, selector: #selector(handleNavigate(_:)), name: .browserLaneNavigate, object: nil)
        show(.browser)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func handleNavigate(_ note: Notification) {
        guard let screen = note.object as? Screen else { return }
        show(screen)
    }

    func show(_ screen: Screen) {
        currentChild?.view.removeFromSuperview()
        currentChild?.removeFromParent()

        let vc: NSViewController = switch screen {
        case .browser:
            BrowserViewController()
        case .addSite:
            AddSiteViewController()
        case .readiness:
            ReadinessViewController()
        case .settings:
            SettingsViewController()
        }
        addChild(vc)
        vc.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(vc.view)
        NSLayoutConstraint.activate([
            vc.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            vc.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            vc.view.topAnchor.constraint(equalTo: view.topAnchor),
            vc.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        currentChild = vc
        currentScreen = screen
        onScreenChanged?()
    }
}

final class PlaceholderViewController: NSViewController {
    private let screen: Screen

    init(screen: Screen) {
        self.screen = screen
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func loadView() {
        view = NSView()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: screen.title)
        title.font = .systemFont(ofSize: 28, weight: .semibold)

        let subtitle = NSTextField(labelWithString: screen.subtitle)
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textColor = .secondaryLabelColor
        subtitle.lineBreakMode = .byWordWrapping
        subtitle.maximumNumberOfLines = 0

        let placeholder = NSTextField(labelWithString: screen.placeholder)
        placeholder.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        placeholder.textColor = .tertiaryLabelColor
        placeholder.lineBreakMode = .byWordWrapping
        placeholder.maximumNumberOfLines = 0

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(placeholder)
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 32),
        ])
    }
}
