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
    private let popupContainer = NSView()
    private let popupChrome = NSView()
    private let popupTitleLabel = NSTextField(labelWithString: "Sign-in popup")
    private let popupCloseButton = NSButton(title: "Close popup", target: nil, action: nil)
    private var popupWebView: WKWebView?

    // --- Agent read state (POST /answer from the loopback server) ---
    // One read at a time drives the visible webView so the operator can watch;
    // extra requests queue. `activeRead` is set while a navigation is in flight.
    private var activeRead: ((BrowserReadResult) -> Void)?
    private var readQueue: [(query: String, completion: (BrowserReadResult) -> Void)] = []
    private var readTimeout: DispatchWorkItem?

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

        popupContainer.translatesAutoresizingMaskIntoConstraints = false
        popupContainer.wantsLayer = true
        popupContainer.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.32).cgColor
        popupContainer.isHidden = true

        popupChrome.translatesAutoresizingMaskIntoConstraints = false
        popupChrome.wantsLayer = true
        popupChrome.layer?.cornerRadius = 12
        popupChrome.layer?.borderWidth = 1
        popupChrome.layer?.borderColor = NSColor.separatorColor.cgColor
        popupChrome.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let popupToolbar = NSStackView()
        popupToolbar.orientation = .horizontal
        popupToolbar.alignment = .centerY
        popupToolbar.spacing = 8
        popupToolbar.translatesAutoresizingMaskIntoConstraints = false

        popupTitleLabel.textColor = .labelColor
        popupTitleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        popupTitleLabel.lineBreakMode = .byTruncatingMiddle
        popupTitleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        popupCloseButton.bezelStyle = .rounded
        popupCloseButton.target = self
        popupCloseButton.action = #selector(closePopup)

        popupToolbar.addArrangedSubview(popupTitleLabel)
        popupToolbar.addArrangedSubview(popupCloseButton)
        popupChrome.addSubview(popupToolbar)
        popupContainer.addSubview(popupChrome)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(toolbar)
        view.addSubview(authRecoveryView)
        view.addSubview(webView)
        view.addSubview(popupContainer)

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

            popupContainer.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            popupContainer.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            popupContainer.topAnchor.constraint(equalTo: webView.topAnchor),
            popupContainer.bottomAnchor.constraint(equalTo: webView.bottomAnchor),

            popupChrome.centerXAnchor.constraint(equalTo: popupContainer.centerXAnchor),
            popupChrome.centerYAnchor.constraint(equalTo: popupContainer.centerYAnchor),
            popupChrome.widthAnchor.constraint(greaterThanOrEqualToConstant: 520),
            popupChrome.widthAnchor.constraint(lessThanOrEqualTo: popupContainer.widthAnchor, multiplier: 0.86),
            popupChrome.heightAnchor.constraint(greaterThanOrEqualToConstant: 520),
            popupChrome.heightAnchor.constraint(lessThanOrEqualTo: popupContainer.heightAnchor, multiplier: 0.88),

            popupToolbar.leadingAnchor.constraint(equalTo: popupChrome.leadingAnchor, constant: 12),
            popupToolbar.trailingAnchor.constraint(equalTo: popupChrome.trailingAnchor, constant: -12),
            popupToolbar.topAnchor.constraint(equalTo: popupChrome.topAnchor, constant: 10),
            popupToolbar.heightAnchor.constraint(equalToConstant: 30),
        ])

        // A pending handoff URL (from Add Site / Readiness) wins over the default.
        if let pending = BrowserLaneNavigator.shared.pendingURL {
            BrowserLaneNavigator.shared.pendingURL = nil
            load(pending.absoluteString)
        } else {
            load(BrowserLaneSettings.shared.defaultURL)
        }

        // Become the read driver so the loopback /answer server can drive this view.
        BrowserReadService.shared.driver = self
        BrowserLaneLoginService.shared.driver = self
    }

    private func showPopup(_ popup: WKWebView, initialURL: URL?) {
        closePopup()
        popupWebView = popup
        popup.navigationDelegate = self
        popup.uiDelegate = self
        popup.customUserAgent = BrowserViewController.safariUserAgent
        popup.translatesAutoresizingMaskIntoConstraints = false
        popupChrome.addSubview(popup)
        popupContainer.isHidden = false
        popupTitleLabel.stringValue = initialURL?.host ?? "Sign-in popup"
        statusLabel.stringValue = "Opened sign-in popup: \(initialURL?.host ?? "authentication")"
        updateAuthRecovery(for: initialURL)
        NSLayoutConstraint.activate([
            popup.leadingAnchor.constraint(equalTo: popupChrome.leadingAnchor),
            popup.trailingAnchor.constraint(equalTo: popupChrome.trailingAnchor),
            popup.topAnchor.constraint(equalTo: popupTitleLabel.superview!.bottomAnchor, constant: 10),
            popup.bottomAnchor.constraint(equalTo: popupChrome.bottomAnchor),
        ])
    }

    @objc private func closePopup() {
        popupWebView?.navigationDelegate = nil
        popupWebView?.uiDelegate = nil
        popupWebView?.removeFromSuperview()
        popupWebView = nil
        popupContainer.isHidden = true
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
        if webView === popupWebView {
            popupTitleLabel.stringValue = webView.url?.host ?? "Sign-in popup"
            statusLabel.stringValue = "Sign-in popup: \(webView.url?.host ?? "loaded")"
        } else {
            addressField.stringValue = webView.url?.absoluteString ?? addressField.stringValue
            statusLabel.stringValue = webView.url?.host ?? "Loaded"
            // If a read navigation just finished, extract and return it.
            if activeRead != nil {
                // Small settle delay lets client-rendered results paint before extraction.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                    self?.extractActiveRead()
                }
            }
        }
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
    /// `target="_blank"` window. Return a real child WKWebView so Google GSI
    /// keeps its opener relationship and can post the login result back.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            configuration.websiteDataStore = WKWebsiteDataStore.default()
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
            configuration.defaultWebpagePreferences.allowsContentJavaScript = true
            let popup = WKWebView(frame: .zero, configuration: configuration)
            showPopup(popup, initialURL: url)
            return popup
        }
        return nil
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView === popupWebView {
            closePopup()
            statusLabel.stringValue = "Sign-in popup closed"
        }
    }
}

// MARK: - Agent reads (POST /answer)

extension BrowserViewController: BrowserLaneLoginDriver {
    func currentHost() -> String? { webView.url?.host }

    /// Runs in an isolated content world so the page's own scripts cannot observe
    /// or shim what a login step does (a page can redefine
    /// HTMLInputElement.prototype.value in its own world).
    func runScript(_ js: String, completion: @escaping (Result<String, Error>) -> Void) {
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { result in
            switch result {
            case .success(let value):
                completion(.success((value as? String) ?? "missing"))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }
}

extension BrowserViewController: BrowserReadDriver {
    /// Serialized so each read owns the visible view for its duration. Called on
    /// the main thread by BrowserReadService.
    func performRead(query: String, completion: @escaping (BrowserReadResult) -> Void) {
        readQueue.append((query: query, completion: completion))
        startNextReadIfIdle()
    }

    private func startNextReadIfIdle() {
        guard activeRead == nil, !readQueue.isEmpty else { return }
        let next = readQueue.removeFirst()
        activeRead = next.completion

        guard let url = BrowserURLBuilder.url(for: next.query) else {
            finishRead(.failed("invalid_query"))
            return
        }
        addressField.stringValue = url.absoluteString
        statusLabel.stringValue = "Agent read: \(url.host ?? next.query)"
        updateAuthRecovery(for: url)
        webView.load(URLRequest(url: url))

        // Fallback if didFinish never arrives (SPA / stalled load): extract what
        // is there after a bounded wait rather than hanging the agent.
        let timeout = DispatchWorkItem { [weak self] in self?.extractActiveRead(timedOut: true) }
        readTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
    }

    /// Pull visible text + on-page links out of the loaded page.
    private func extractActiveRead(timedOut: Bool = false) {
        guard activeRead != nil else { return }
        let js = """
        (function() {
          var links = [];
          var seen = {};
          var anchors = document.querySelectorAll('a[href]');
          for (var i = 0; i < anchors.length && links.length < 20; i++) {
            var a = anchors[i];
            var href = a.href || '';
            var title = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ');
            if (href.indexOf('http') !== 0 || !title || seen[href]) continue;
            seen[href] = true;
            links.push({ title: title.slice(0, 180), url: href });
          }
          var text = (document.body ? (document.body.innerText || '') : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000);
          return JSON.stringify({ title: document.title || '', url: location.href, text: text, links: links });
        })()
        """
        webView.evaluateJavaScript(js) { [weak self] value, _ in
            guard let self else { return }
            guard self.activeRead != nil else { return }
            guard
                let json = value as? String,
                let data = json.data(using: .utf8),
                let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                self.finishRead(.failed(timedOut ? "read_timeout" : "extraction_failed"))
                return
            }
            let pageTitle = obj["title"] as? String ?? ""
            let pageUrl = obj["url"] as? String ?? self.webView.url?.absoluteString ?? ""
            let text = obj["text"] as? String ?? ""
            let now = ISO8601DateFormatter().string(from: Date())
            var citations: [(title: String, url: String, retrievedAt: String)] = []
            if let links = obj["links"] as? [[String: Any]] {
                for link in links {
                    if let u = link["url"] as? String {
                        let t = (link["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? u
                        citations.append((title: t, url: u, retrievedAt: now))
                    }
                }
            }
            let header = pageTitle.isEmpty ? pageUrl : "\(pageTitle) — \(pageUrl)"
            let answer = text.isEmpty ? "(no readable text extracted from \(pageUrl))" : "\(header)\n\n\(text)"
            self.finishRead(BrowserReadResult(status: "completed", answer: answer, citations: citations, errorCode: nil))
        }
    }

    private func finishRead(_ result: BrowserReadResult) {
        readTimeout?.cancel()
        readTimeout = nil
        let completion = activeRead
        activeRead = nil
        statusLabel.stringValue = result.status == "completed" ? "Agent read complete" : "Agent read failed: \(result.errorCode ?? "")"
        completion?(result)
        startNextReadIfIdle()
    }
}
