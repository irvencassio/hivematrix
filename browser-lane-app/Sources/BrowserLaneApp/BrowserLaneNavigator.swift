import AppKit

/// Lightweight bridge so any screen (Add Site, Readiness dashboard) can hand a URL
/// off to the persistent in-app WebKit browser, where the operator completes
/// SSO/2FA and the signed-in session is preserved and reused.
final class BrowserLaneNavigator {
    static let shared = BrowserLaneNavigator()

    /// Set by ContentViewController: switches to the Browser screen and loads `url`.
    var openHandler: ((URL) -> Void)?

    /// Picked up by BrowserViewController on load when it is shown via a handoff.
    var pendingURL: URL?

    func openInBrowser(_ url: URL) {
        if let openHandler {
            openHandler(url)
        } else {
            // No in-app browser wired yet — fall back to the system browser.
            NSWorkspace.shared.open(url)
        }
    }
}
