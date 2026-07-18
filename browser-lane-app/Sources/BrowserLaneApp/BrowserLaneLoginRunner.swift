import Foundation

/// The outcome of typing a credential into a page.
enum BrowserLaneCredentialFill: Equatable {
    case filled
    /// The selector wasn't present in any frame.
    case noFrame
    /// The frame that has the field is not on an allowed origin. `host` is that
    /// frame's WebKit security-origin host — the authoritative origin, not a
    /// JS-reported value.
    case originRefused(host: String)
}

/// What the WebView must be able to do for a recipe to run. Implemented by
/// BrowserViewController (it owns the WKWebView); a protocol so the step engine
/// stays testable and the runner cannot reach anything else.
///
/// Frame-aware because real sign-ins (Apple ID, much enterprise SSO) put the
/// credential form in a cross-origin iframe: the top page has no fields at all,
/// and JS run only in the main frame can't see them.
protocol BrowserLaneLoginDriver: AnyObject {
    /// Run `js` in the first frame (main frame, then each child frame) where it
    /// returns something other than "missing". For non-credential steps —
    /// click/clickText/waitFor/submit/non-secret fill.
    func runInFrames(_ js: String, completion: @escaping (Result<String, Error>) -> Void)

    /// Type a credential into the frame containing `selector`, but ONLY if that
    /// frame's origin host is in `allowedHosts`. Atomic on purpose: the frame is
    /// located and origin-checked natively — against WKFrameInfo.securityOrigin,
    /// which JS in the page cannot spoof — before anything is typed. There is no
    /// separate "which host?" call the runner could act on with a stale answer.
    func fillCredential(
        selector: String,
        value: String,
        allowedHosts: [String],
        completion: @escaping (BrowserLaneCredentialFill) -> Void
    )
}

/// Holds the live browser so the Readiness screen's sign-in button can drive it.
/// Mirrors BrowserReadService's driver registry; weak, so a torn-down browser
/// leaves this nil rather than a zombie.
final class BrowserLaneLoginService {
    static let shared = BrowserLaneLoginService()
    weak var driver: BrowserLaneLoginDriver?
}

enum BrowserLaneLoginOutcome: Equatable {
    /// Every step ran. Whatever is on screen now (2FA, a dashboard) is the human's.
    case completed
    /// A step's selector never appeared — the page is not what the recipe expects.
    /// Usually 2FA, a consent screen, or the site changed its markup.
    case stalled(step: Int, selector: String)
    /// The page is not on a host this site is allowed to sign in to.
    case originRefused(host: String)
    case failed(String)
}

/// Runs a site's login recipe against the in-app browser.
///
/// Invariants this type exists to hold:
/// - It is only ever called from an explicit operator click. It is not a lane
///   tool, not reachable from LaneToolContext/task dispatch, and the daemon has
///   no endpoint for it. Q20's agent-side `credential_fill` refusal is untouched.
/// - The sign-in value is read from Keychain, substituted into a single JS call,
///   and never returned, logged, or handed to the daemon.
/// - Before any step that carries a sign-in, the live page host must match the
///   site's allowed domains. A redirect to somewhere unexpected stops the run.
final class BrowserLaneLoginRunner {
    private let driver: BrowserLaneLoginDriver
    private let allowedHosts: [String]

    /// Holds the runner alive for the duration of a run.
    ///
    /// `run()` returns immediately — every step is an async JS callback — so a
    /// caller's local `let runner` is released the moment it returns. The only
    /// things still referencing the runner are its own `[weak self]` callbacks,
    /// which then find nil and return: the run dies silently before step 1, with
    /// no error and no completion. Cleared when the run finishes, so this is a
    /// scoped self-reference, not a leak.
    private var activeRun: BrowserLaneLoginRunner?

    init(driver: BrowserLaneLoginDriver, allowedHosts: [String]) {
        self.driver = driver
        self.allowedHosts = allowedHosts
    }

    /// Host matching: exact, or a subdomain of an allowed host. Deliberately not a
    /// `contains` check — "evil-linkedin.com" contains "linkedin.com".
    static func hostIsAllowed(_ host: String, allowed: [String]) -> Bool {
        let host = host.lowercased()
        return allowed.contains { raw in
            let domain = raw.lowercased()
            guard !domain.isEmpty else { return false }
            return host == domain || host.hasSuffix("." + domain)
        }
    }

    func run(
        _ recipe: BrowserLaneLoginRecipe,
        username: String,
        secretValue: String,
        completion: @escaping (BrowserLaneLoginOutcome) -> Void
    ) {
        activeRun = self
        step(recipe.steps, index: 0, username: username, secretValue: secretValue) { [weak self] outcome in
            self?.activeRun = nil
            completion(outcome)
        }
    }

    private func step(
        _ steps: [BrowserLaneLoginStep],
        index: Int,
        username: String,
        secretValue: String,
        completion: @escaping (BrowserLaneLoginOutcome) -> Void
    ) {
        guard index < steps.count else { completion(.completed); return }
        let current = steps[index]

        let advance: (Result<String, Error>) -> Void = { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                completion(.failed(error.localizedDescription))
            case .success(let value) where value == "ok":
                self.step(steps, index: index + 1, username: username, secretValue: secretValue, completion: completion)
            case .success:
                completion(.stalled(step: index + 1, selector: current.selector))
            }
        }
        let next = { [weak self] in
            self?.step(steps, index: index + 1, username: username, secretValue: secretValue, completion: completion)
        }

        switch current {
        case .click(let selector):
            driver.runInFrames(Self.clickJS(selector), completion: advance)
        case .submit(let selector):
            driver.runInFrames(Self.submitJS(selector), completion: advance)
        case .wait(let seconds):
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { advance(.success("ok")) }
        case .waitFor(let selector, let timeout):
            poll(Self.existsJS(selector), deadline: Date().addingTimeInterval(timeout), completion: advance)
        case .clickText(let selector, let text, let timeout):
            // Poll: these buttons are typically disabled until the field they
            // depend on is filled, so the first look often finds nothing clickable.
            poll(
                Self.clickTextJS(selector, text),
                deadline: Date().addingTimeInterval(timeout),
                completion: advance
            )
        case .fill(let selector, let value):
            let text: String = switch value {
            case .username: username
            case .secret: secretValue
            case .literal(let raw): raw
            }
            if value.isSecret {
                // The origin check lives inside fillCredential, checked per-frame
                // against the frame the credential actually lands in — not the top
                // page, which for an iframe login is a different origin entirely.
                driver.fillCredential(selector: selector, value: text, allowedHosts: allowedHosts) { outcome in
                    switch outcome {
                    case .filled: next()
                    case .noFrame: completion(.stalled(step: index + 1, selector: selector))
                    case .originRefused(let host): completion(.originRefused(host: host))
                    }
                }
            } else {
                driver.runInFrames(Self.fillJS(selector, text), completion: advance)
            }
        }
    }

    /// Re-runs `js` until it returns "ok" or the deadline passes. Polling rather
    /// than a mutation observer: simpler, and a login page that never shows the
    /// next field is the normal case (2FA), not an error to be clever about.
    ///
    /// The script must be idempotent until it succeeds — existsJS/clickTextJS both
    /// no-op when there is nothing to act on.
    private func poll(
        _ js: String,
        deadline: Date,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        driver.runInFrames(js) { [weak self] result in
            guard let self else { return }
            if case .success("ok") = result { completion(.success("ok")); return }
            if case .failure(let error) = result { completion(.failure(error)); return }
            guard Date() < deadline else { completion(.success("timeout")); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.poll(js, deadline: deadline, completion: completion)
            }
        }
    }

    // MARK: - JS

    /// JSON-encodes into a JS string literal. Selectors and typed values are
    /// interpolated into source, so anything less is a string-escape bug waiting
    /// to happen (a password containing a quote would break the script, or worse).
    static func jsString(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
            let array = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return String(array.dropFirst().dropLast()) // ["x"] -> "x"
    }

    static func existsJS(_ selector: String) -> String {
        """
        (function(){var e=document.querySelector(\(jsString(selector)));
        if(!e)return "missing";
        var r=e.getBoundingClientRect();
        return (r.width>0&&r.height>0)?"ok":"missing";})()
        """
    }

    static func clickJS(_ selector: String) -> String {
        """
        (function(){var e=document.querySelector(\(jsString(selector)));
        if(!e)return "missing";e.click();return "ok";})()
        """
    }

    /// Clicks the first visible, enabled match whose text contains `text`.
    /// Returns "missing" (not an error) when nothing is clickable yet, so poll()
    /// can keep trying while the page enables the button.
    static func clickTextJS(_ selector: String, _ text: String) -> String {
        """
        (function(){var want=\(jsString(text)).toLowerCase();
        var all=document.querySelectorAll(\(jsString(selector)));
        for(var i=0;i<all.length;i++){var e=all[i];
        if(e.disabled||e.getAttribute("aria-disabled")==="true")continue;
        var r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;
        var t=(e.innerText||e.textContent||e.value||"").trim().toLowerCase();
        if(t.indexOf(want)!==-1){e.click();return "ok";}}
        return "missing";})()
        """
    }

    /// Prefers the real form. SPA logins increasingly have no form element at all,
    /// so fall back to pressing Enter in the field — clicking the input itself
    /// (the obvious fallback) does nothing at all on those pages.
    static func submitJS(_ selector: String) -> String {
        """
        (function(){var e=document.querySelector(\(jsString(selector)));
        if(!e)return "missing";
        var f=e.form||e.closest("form");
        if(f){if(typeof f.requestSubmit==="function"){f.requestSubmit();}else{f.submit();}return "ok";}
        var opts={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true};
        e.focus();
        e.dispatchEvent(new KeyboardEvent("keydown",opts));
        e.dispatchEvent(new KeyboardEvent("keypress",opts));
        e.dispatchEvent(new KeyboardEvent("keyup",opts));
        return "ok";})()
        """
    }

    /// Sets the value through the native setter and fires input/change, so
    /// React/Angular-controlled inputs actually register it — assigning .value
    /// directly is silently ignored by their state and the form submits empty.
    ///
    /// focus/blur are part of the contract, not decoration: a validation-gated
    /// form (Apple ID is the case that surfaced this) keeps its submit button
    /// DISABLED until the field has been focused and then blurred, so a fill
    /// that only dispatches input/change leaves the credential visibly typed
    /// next to a dead "Continue" button.
    static func fillJS(_ selector: String, _ value: String) -> String {
        """
        (function(){var e=document.querySelector(\(jsString(selector)));
        if(!e)return "missing";
        try{e.focus();}catch(_){}
        var p=Object.getPrototypeOf(e);
        var d=Object.getOwnPropertyDescriptor(p,"value");
        if(d&&d.set){d.set.call(e,\(jsString(value)));}else{e.value=\(jsString(value));}
        e.dispatchEvent(new Event("input",{bubbles:true}));
        e.dispatchEvent(new Event("change",{bubbles:true}));
        e.dispatchEvent(new Event("blur",{bubbles:true}));
        try{e.blur();}catch(_){}
        return "ok";})()
        """
    }
}
