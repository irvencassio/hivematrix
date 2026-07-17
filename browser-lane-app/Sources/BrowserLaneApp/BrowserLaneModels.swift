import AppKit
import Foundation

/// How a Browser Lane site authenticates. Only the Keychain strategy captures a
/// credential (into the macOS Keychain). Google/Microsoft SSO and manual sessions
/// are human handoffs — Browser Lane never automates or stores their credentials.
enum BrowserLaneAuthStrategy: String, CaseIterable {
    case keychainPassword = "keychain_password"
    case googleSso = "google_sso"
    case microsoftSso = "microsoft_sso"
    case manualSession = "manual_session"

    /// Only the Keychain strategy captures a username/credential pair.
    var usesKeychainPassword: Bool { self == .keychainPassword }

    /// Provider auth domains (public hostnames) seeded into Allowed domains for SSO, so
    /// readiness/popup matching recognises the provider's login host.
    var providerDomains: [String] {
        switch self {
        case .googleSso:    return ["accounts.google.com", "google.com"]
        case .microsoftSso: return ["login.microsoftonline.com", "login.live.com"]
        default:            return []
        }
    }

    /// Default auth/login entry URL hint for an SSO handoff.
    var defaultAuthURL: String? {
        switch self {
        case .googleSso:    return "https://accounts.google.com"
        case .microsoftSso: return "https://login.microsoftonline.com"
        default:            return nil
        }
    }
}

/// Whether agents may write to a site. Enforced daemon-side at dispatch
/// (`executeBrowserBeeRun`), surfaced here as a badge — display only, never the gate.
enum BrowserLaneAccessMode: String, CaseIterable {
    case readwrite
    case readonly

    /// Picker order — read-write first because it is the default the daemon
    /// applies to any site that never set one.
    static let displayOrder: [BrowserLaneAccessMode] = [.readwrite, .readonly]

    /// What choosing this mode actually does, in the operator's terms.
    var explanation: String {
        switch self {
        case .readwrite:
            return "Read-write: agents may fill forms and act on this site on your behalf."
        case .readonly:
            return "Read-only: agents may read and research this site, but form-fill and site-actions are refused."
        }
    }

    /// Canopy's convention: green = read-only (safe), red = read-write (agents may edit).
    var tint: NSColor { self == .readonly ? .systemGreen : .systemRed }
    var symbol: String { self == .readonly ? "eye.fill" : "pencil.circle.fill" }
    var label: String { self == .readonly ? "Read-only" : "Read-write" }
    var pickerTitle: String { self == .readonly ? "Read-only" : "Read-write" }
    var help: String {
        self == .readonly
            ? "Read-only — write-shaped agent jobs are refused for this site"
            : "Read-write — agents may run write-shaped jobs on this site"
    }
}

/// One row of the Command Log — a `browser:*` audit entry from
/// GET /browser-lane/history. Metadata only; the daemon scrubs values.
struct BrowserLaneHistoryEntry: Equatable {
    let ts: String
    let event: String
    let actor: String
    let actorKind: String
    let target: String
    let status: String
    let summary: String

    var isAgent: Bool { actorKind == "agent" }

    /// The short adapter-style badge Canopy shows next to the timestamp — here the
    /// `browser:` event suffix (read, job_created, credential_fill, blocked).
    var badge: String {
        event.hasPrefix("browser:") ? String(event.dropFirst("browser:".count)) : event
    }

    /// Parsed for display; an unreadable ts renders as "—" rather than crashing.
    var date: Date? { BrowserLaneTimestamp.parse(ts) }
}

/// The daemon stamps audit timestamps via JS `toISOString()`, which always
/// includes milliseconds ("2026-07-16T19:38:56.252Z"). A default
/// ISO8601DateFormatter rejects fractional seconds and returns nil — which is why
/// every Command Log row showed "—" until this was opted in. Kept as a shared
/// parser so no caller re-learns that.
enum BrowserLaneTimestamp {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain = ISO8601DateFormatter()

    static func parse(_ raw: String) -> Date? {
        fractional.date(from: raw) ?? plain.date(from: raw)
    }
}

struct BrowserLaneSite: Codable, Equatable {
    var id: String
    var displayName: String
    var homeUrl: String
    var loginUrl: String
    var allowedDomains: [String]
    /// Keychain reference for `keychain_password`, or a plain session label for
    /// SSO/manual sites. Always a pointer/label, never a credential value.
    var credentialRef: String
    var authStrategy: String
    /// Public account label/email the site signs in as (e.g. an SSO email). Not a credential.
    var providerAccount: String?
    /// `readwrite` | `readonly`. Mirrors browser_sites.accessMode; a readonly site
    /// refuses write-shaped agent jobs at dispatch (daemon-side, not just display).
    ///
    /// Optional on purpose: JSONDecoder does NOT fall back to a property's default
    /// value for a missing key, it throws — and `listSites()` swallows that with
    /// `try?`, so a non-optional field here would silently empty the stored site
    /// list of anyone who saved sites before this field existed. Read via `access`.
    var accessMode: String?
    /// This site's login recipe, in the editable text form (see
    /// BrowserLaneLoginRecipe). Placeholders only — never a real sign-in.
    ///
    /// Local-only on purpose: it is deliberately NOT included in the daemon sync
    /// payload, so the recipe cannot reach the daemon, an agent, or a task. That
    /// keeps Q20's agent-side credential_fill refusal structurally true rather
    /// than merely policy — there is nothing on that side to drive a login with.
    /// Optional so sites saved before recipes existed still decode.
    var loginSteps: String?
    var notes: String
    var lastSyncStatus: String
    var createdAt: String
    var updatedAt: String

    static func nowString() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    var strategy: BrowserLaneAuthStrategy {
        BrowserLaneAuthStrategy(rawValue: authStrategy) ?? .manualSession
    }

    /// Non-optional view of `accessMode`; anything unset/unrecognised reads as
    /// read-write, matching the daemon's own `normalizeEnum` default.
    var access: BrowserLaneAccessMode {
        BrowserLaneAccessMode(rawValue: accessMode ?? "") ?? .readwrite
    }

    var primaryDomain: String {
        allowedDomains.first ?? URL(string: homeUrl)?.host ?? id
    }
}

// Cross-screen edit hand-off: Sites → Add/Edit passes a site id only.
final class BrowserLaneEditTarget {
    static let shared = BrowserLaneEditTarget()
    var siteId: String?
    func consume() -> String? { defer { siteId = nil }; return siteId }
}

extension Notification.Name {
    static let browserLaneNavigate = Notification.Name("BrowserLaneNavigate")
    /// Posted by BrowserLaneSiteStore on every mutation, so the sidebar re-renders
    /// no matter which screen made the change.
    static let browserLaneSitesChanged = Notification.Name("BrowserLaneSitesChanged")
    /// Ask the window to show the Command Log scoped to a site id (String object).
    static let browserLaneShowLog = Notification.Name("BrowserLaneShowLog")
}

/// Slugify a display name / domain into a valid site id ([a-z0-9._:-]).
func browserLaneSlug(_ raw: String) -> String {
    let lowered = raw.lowercased()
    var out = ""
    for ch in lowered {
        if ch.isLetter || ch.isNumber || ch == "." || ch == "_" || ch == ":" || ch == "-" {
            out.append(ch)
        } else {
            out.append("-")
        }
    }
    while out.contains("--") { out = out.replacingOccurrences(of: "--", with: "-") }
    return out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

extension BrowserLaneSite {
    /// A blank site for the Add form. Browser Lane is site-agnostic: no vendor is
    /// modeled, preset, or seeded here — every site is user-defined. (A hardcoded
    /// HeyGen preset lived here until 2026-07-17; it made one tenant's site look
    /// like a product concept.)
    static func empty() -> BrowserLaneSite {
        BrowserLaneSite(
            id: "",
            displayName: "",
            homeUrl: "",
            loginUrl: "",
            allowedDomains: [],
            credentialRef: "",
            authStrategy: BrowserLaneAuthStrategy.manualSession.rawValue,
            providerAccount: "",
            accessMode: BrowserLaneAccessMode.readwrite.rawValue,
            loginSteps: nil,
            notes: "",
            lastSyncStatus: "not synced",
            createdAt: BrowserLaneSite.nowString(),
            updatedAt: BrowserLaneSite.nowString()
        )
    }
}
