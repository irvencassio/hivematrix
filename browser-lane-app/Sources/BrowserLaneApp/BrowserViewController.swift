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

    /// One persistent website data store, shared across every WKWebView Browser Lane
    /// creates (including OAuth popups). A completed Google/Microsoft sign-in is
    /// written to this store and reused on the next launch — no re-login each time.
    private static let sharedConfiguration: WKWebViewConfiguration = {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        return config
    }()

    private lazy var webView = WKWebView(frame: .zero, configuration: BrowserViewController.sharedConfiguration)

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

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(toolbar)
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            toolbar.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),

            addressField.widthAnchor.constraint(greaterThanOrEqualToConstant: 360),

            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 16),
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
        webView.load(URLRequest(url: url))
    }
}

extension BrowserViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        addressField.stringValue = webView.url?.absoluteString ?? addressField.stringValue
        statusLabel.stringValue = webView.url?.host ?? "Loaded"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        statusLabel.stringValue = error.localizedDescription
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        statusLabel.stringValue = error.localizedDescription
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
