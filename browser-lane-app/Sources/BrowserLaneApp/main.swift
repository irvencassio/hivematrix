import AppKit

final class BrowserLaneApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 920, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Browser Lane"
        window.center()
        window.contentView = BrowserLaneDashboardView(frame: window.contentView?.bounds ?? .zero)
        window.makeKeyAndOrderFront(nil)
        self.window = window
        app.activate(ignoringOtherApps: true)
    }
}

final class BrowserLaneDashboardView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Browser Lane")
        title.font = .systemFont(ofSize: 28, weight: .semibold)

        let subtitle = NSTextField(labelWithString: "Daily authentication readiness, Keychain-backed site setup, and browser session health.")
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textColor = .secondaryLabelColor

        let status = NSTextField(labelWithString: "No sites configured yet. Use hive browser auth set <site-id> --credential-ref hivematrix.browser.<site>.<account>, then finish the secret entry in this app.")
        status.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        status.lineBreakMode = .byWordWrapping
        status.maximumNumberOfLines = 0

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(status)
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 32),
        ])
    }

    required init?(coder: NSCoder) {
        nil
    }
}

let app = NSApplication.shared
let delegate = BrowserLaneApp()
app.delegate = delegate
app.run()
