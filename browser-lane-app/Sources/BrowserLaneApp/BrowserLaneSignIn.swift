import AppKit

/// The one sign-in path, shared by every surface that offers it (the Readiness
/// card's button and the sidebar's context menu).
///
/// Deliberately one implementation rather than one per surface: this reads a
/// stored sign-in out of the Keychain, and a second copy is a second place for
/// the origin check, the audit call, or the clipboard timer to drift out of sync.
///
/// Every entry point is an explicit operator click. Nothing here is scheduled,
/// reachable from a lane tool, or callable by the daemon — see DECISIONS.md Q19/Q22.
enum BrowserLaneSignIn {
    /// True when this site has a stored sign-in to retrieve at all. SSO/manual
    /// sites have nothing to fill, so callers should hide the affordance.
    static func isAvailable(for site: BrowserLaneSite) -> Bool {
        site.strategy.usesKeychainPassword
    }

    /// Reads the Keychain, opens the site's login page, then either runs its
    /// recipe or falls back to the clipboard handoff.
    static func start(site incoming: BrowserLaneSite) {
        // Re-read by id rather than trusting the caller's copy. The sidebar hands
        // over a row cached since its last reload, so an edit to allowed domains
        // or login steps can be invisible to it — and the origin check is a
        // security control that must run against the current value, not a stale
        // snapshot. Falls back to the caller's copy only if the site is gone.
        let site = BrowserLaneSiteStore.shared.listSites()
            .first(where: { $0.id == incoming.id }) ?? incoming

        guard isAvailable(for: site) else { return }
        do {
            let (username, secretValue) = try BrowserLaneKeychain.shared.readCredential(siteId: site.id)

            if let url = URL(string: site.loginUrl), url.scheme?.hasPrefix("http") == true {
                BrowserLaneNavigator.shared.openInBrowser(url)
            }

            // A site with a recipe drives its own multi-step form. Everything else
            // keeps the clipboard handoff — no recipe means no DOM knowledge, and
            // guessing at which field is which is how a sign-in gets typed somewhere wrong.
            if let recipe = recipe(for: site), !recipe.isEmpty {
                runRecipe(recipe, site: site, username: username, secretValue: secretValue)
                return
            }

            handOffViaClipboard(site: site, username: username, secretValue: secretValue)
        } catch {
            alert("Can't sign in to \(site.displayName) automatically", error.localizedDescription, warning: true)
        }
    }

    private static func recipe(for site: BrowserLaneSite) -> BrowserLaneLoginRecipe? {
        guard let stored = site.loginSteps, !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return try? BrowserLaneLoginRecipe.parse(stored)
    }

    private static func runRecipe(
        _ recipe: BrowserLaneLoginRecipe,
        site: BrowserLaneSite,
        username: String,
        secretValue: String
    ) {
        guard let driver = BrowserLaneLoginService.shared.driver else {
            alert(
                "Can't sign in to \(site.displayName)",
                "The in-app browser isn't open yet. Try again once the site has loaded.",
                warning: true
            )
            return
        }
        let runner = BrowserLaneLoginRunner(driver: driver, allowedHosts: site.allowedDomains)

        // Give the login page a moment to start loading; the recipe's own waitFor
        // steps do the real waiting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            runner.run(recipe, username: username, secretValue: secretValue) { outcome in
                DispatchQueue.main.async {
                    BrowserLaneDaemonClient.shared.recordCredentialUse(siteId: site.id) { _ in }
                    report(outcome, site: site)
                }
            }
        }
    }

    private static func handOffViaClipboard(site: BrowserLaneSite, username: String, secretValue: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(secretValue, forType: .string)
        scheduleClipboardClear(expected: secretValue)
        BrowserLaneDaemonClient.shared.recordCredentialUse(siteId: site.id) { _ in }
        alert(
            "Ready to sign in to \(site.displayName)",
            "Username: \(username)\nThe saved sign-in was copied to the clipboard (clears in 45s).\n\nPaste it into the sign-in form, finish any 2FA if asked, then click Run readiness to confirm.",
            warning: false
        )
    }

    /// Only clears if the clipboard still holds what we put there — never stomps
    /// something the operator copied in the meantime.
    private static func scheduleClipboardClear(expected: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
            let pasteboard = NSPasteboard.general
            if pasteboard.string(forType: .string) == expected {
                pasteboard.clearContents()
            }
        }
    }

    private static func report(_ outcome: BrowserLaneLoginOutcome, site: BrowserLaneSite) {
        switch outcome {
        case .completed:
            // No alert on success: the signed-in page IS the result, and a modal
            // saying so is a click you have to dismiss to see it. Only the
            // outcomes you cannot see for yourself get one.
            //
            // The old alert's one useful job was "then click Run readiness" — do
            // that instead, so the sidebar dot reflects the new session on its own.
            BrowserLaneDaemonClient.shared.runReadiness(siteId: site.id) { _ in
                DispatchQueue.main.async {
                    // Re-reads sites + the readiness dashboard, which repaints the dot.
                    NotificationCenter.default.post(name: .browserLaneSitesChanged, object: nil)
                }
            }
        case .stalled(let step, let selector):
            // Expected whenever a flow branches (2FA, consent) — name where it
            // stopped rather than implying the recipe is broken.
            alert(
                "Stopped partway through \(site.displayName)",
                "Step \(step) waited for “\(selector)” and it never appeared. If the page is asking for 2FA or a code, finish by hand. If the site changed its sign-in form, update the login steps under Advanced.",
                warning: false
            )
        case .originRefused(let host):
            alert(
                "Refused to sign in on \(host)",
                "That page isn't one of \(site.displayName)'s allowed domains, so the saved sign-in was not entered. Check the site's allowed domains, or finish signing in by hand.",
                warning: true
            )
        case .failed(let message):
            alert("Can't sign in to \(site.displayName)", message, warning: true)
        }
    }

    private static func alert(_ message: String, _ detail: String, warning: Bool) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.alertStyle = warning ? .warning : .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
