import AppKit
import WebKit

enum BrowserURLBuilder {
    static func url(for input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return URL(string: "https://www.google.com")
        }

        if let url = URL(string: trimmed),
           let scheme = url.scheme?.lowercased(),
           ["http", "https"].contains(scheme),
           url.host != nil {
            return url
        }

        if looksLikeDomain(trimmed), let url = URL(string: "https://\(trimmed)") {
            return url
        }

        var components = URLComponents(string: "https://www.google.com/search?q=")
        components?.queryItems = [URLQueryItem(name: "q", value: trimmed)]
        return components?.url
    }

    private static func looksLikeDomain(_ value: String) -> Bool {
        guard !value.contains(" ") else { return false }
        guard value.contains(".") else { return false }
        return value.range(of: #"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]+)?(/[^\s]*)?$"#, options: .regularExpression) != nil
    }
}

final class BrowserViewController: NSViewController {
    private let addressField = NSSearchField()
    private let goButton = NSButton(title: "Go", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "Ready")
    private let authRecoveryView = NSStackView()
    private let authRecoveryLabel = NSTextField(labelWithString: "Google sign-in can block embedded browser flows. If this page stays blank, reload auth or open the same URL in Chrome/Safari.")
    private let reloadAuthButton = NSButton(title: "Reload auth", target: nil, action: nil)
    private let openInChromeButton = NSButton(title: "Open in Chrome", target: nil, action: nil)
    private let openInSafariButton = NSButton(title: "Open in Safari", target: nil, action: nil)

    private static let safariUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"

    /// One persistent website data store, shared across every WKWebView Browser Lane
    /// creates (including OAuth popups). A completed Google/Microsoft sign-in is
    /// written to this store and reused on the next launch — no re-login each time.
    private static let sharedConfiguration: WKWebViewConfiguration = {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        return config
    }()

    private lazy var webView: WKWebView = {
        let view = WKWebView(frame: .zero, configuration: BrowserViewController.sharedConfiguration)
        view.customUserAgent = BrowserViewController.safariUserAgent
        return view
    }()

    override func loadView() {
        view = NSView()

        let toolbar = NSStackView()
        toolbar.orientation = .horizontal
        toolbar.alignment = .centerY
        toolbar.spacing = 8
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        addressField.placeholderString = "Search Google or enter URL"
        addressField.stringValue = "https://www.google.com"
        addressField.target = self
        addressField.action = #selector(loadAddress)
        addressField.translatesAutoresizingMaskIntoConstraints = false

        goButton.target = self
        goButton.action = #selector(loadAddress)
        goButton.bezelStyle = .rounded

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 12)

        toolbar.addArrangedSubview(addressField)
        toolbar.addArrangedSubview(goButton)
        toolbar.addArrangedSubview(statusLabel)

        authRecoveryView.orientation = .horizontal
        authRecoveryView.alignment = .centerY
        authRecoveryView.spacing = 10
        authRecoveryView.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        authRecoveryView.translatesAutoresizingMaskIntoConstraints = false
        authRecoveryView.wantsLayer = true
        authRecoveryView.layer?.cornerRadius = 8
        authRecoveryView.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.14).cgColor
        authRecoveryView.isHidden = true

        authRecoveryLabel.textColor = .labelColor
        authRecoveryLabel.font = .systemFont(ofSize: 12, weight: .medium)
        authRecoveryLabel.lineBreakMode = .byWordWrapping
        authRecoveryLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        for button in [reloadAuthButton, openInChromeButton, openInSafariButton] {
            button.bezelStyle = .rounded
        }
        reloadAuthButton.target = self
        reloadAuthButton.action = #selector(reloadAuth)
        openInChromeButton.target = self
        openInChromeButton.action = #selector(openAuthInChrome)
        openInSafariButton.target = self
        openInSafariButton.action = #selector(openAuthInSafari)

        authRecoveryView.addArrangedSubview(authRecoveryLabel)
        authRecoveryView.addArrangedSubview(reloadAuthButton)
        authRecoveryView.addArrangedSubview(openInChromeButton)
        authRecoveryView.addArrangedSubview(openInSafariButton)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(toolbar)
        view.addSubview(authRecoveryView)
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            toolbar.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),

            addressField.widthAnchor.constraint(greaterThanOrEqualToConstant: 360),

            authRecoveryView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            authRecoveryView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            authRecoveryView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 12),

            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            webView.topAnchor.constraint(equalTo: authRecoveryView.bottomAnchor, constant: 12),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
        ])

        // A pending handoff URL (from Add Site / Readiness) wins over the default.
        if let pending = BrowserLaneNavigator.shared.pendingURL {
            BrowserLaneNavigator.shared.pendingURL = nil
            load(pending.absoluteString)
        } else {
            load(BrowserLaneSettings.shared.defaultURL)
        }
    }

    @objc private func loadAddress() {
        load(addressField.stringValue)
    }

    private func load(_ value: String) {
        guard let url = BrowserURLBuilder.url(for: value) else {
            statusLabel.stringValue = "Invalid URL"
            return
        }

        addressField.stringValue = url.absoluteString
        statusLabel.stringValue = "Loading..."
        updateAuthRecovery(for: url)
        webView.load(URLRequest(url: url))
    }

    private func updateAuthRecovery(for url: URL?) {
        authRecoveryView.isHidden = !isGoogleAuthURL(url)
        if !authRecoveryView.isHidden {
            statusLabel.stringValue = "Google auth: use recovery if the page stays blank"
        }
    }

    private func isGoogleAuthURL(_ url: URL?) -> Bool {
        guard let url, let host = url.host?.lowercased() else { return false }
        let path = url.path.lowercased()
        return host == "accounts.google.com"
            || (host.hasSuffix(".google.com") && (path.contains("/gsi/") || path.contains("/signin") || path.contains("/o/oauth2")))
    }

    @objc private func reloadAuth() {
        guard let url = webView.url ?? BrowserURLBuilder.url(for: addressField.stringValue) else {
            statusLabel.stringValue = "No auth URL to reload"
            return
        }
        statusLabel.stringValue = "Reloading auth..."
        updateAuthRecovery(for: url)
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    @objc private func openAuthInChrome() {
        openCurrentURL(bundleIdentifier: "com.google.Chrome", appName: "Chrome")
    }

    @objc private func openAuthInSafari() {
        openCurrentURL(bundleIdentifier: "com.apple.Safari", appName: "Safari")
    }

    private func openCurrentURL(bundleIdentifier: String, appName: String) {
        guard let url = webView.url ?? BrowserURLBuilder.url(for: addressField.stringValue) else {
            statusLabel.stringValue = "No auth URL to open"
            return
        }

        if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) {
            let config = NSWorkspace.OpenConfiguration()
            NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: config) { [weak self] _, error in
                DispatchQueue.main.async {
                    if let error {
                        self?.statusLabel.stringValue = error.localizedDescription
                    } else {
                        self?.statusLabel.stringValue = "Opened auth URL in \(appName); Browser Lane readiness may still need manual confirmation"
                    }
                }
            }
        } else {
            NSWorkspace.shared.open(url)
            statusLabel.stringValue = "\(appName) not found; opened auth URL with default browser"
        }
    }
}

extension BrowserViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        updateAuthRecovery(for: navigationAction.request.url)
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        addressField.stringValue = webView.url?.absoluteString ?? addressField.stringValue
        statusLabel.stringValue = webView.url?.host ?? "Loaded"
        updateAuthRecovery(for: webView.url)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        statusLabel.stringValue = error.localizedDescription
        updateAuthRecovery(for: webView.url)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        statusLabel.stringValue = error.localizedDescription
        updateAuthRecovery(for: webView.url)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        statusLabel.stringValue = "Browser content reloaded after a WebKit interruption"
        updateAuthRecovery(for: webView.url)
        webView.reload()
    }
}

extension BrowserViewController: WKUIDelegate {
    /// OAuth providers often open the consent/login step in a popup or a
    /// `target="_blank"` window. Load that request into the main, persistent web
    /// view instead of dropping it, so the SSO handoff completes in one session.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            statusLabel.stringValue = "Continuing sign-in: \(url.host ?? url.absoluteString)"
            webView.load(navigationAction.request)
        }
        return nil
    }
}
