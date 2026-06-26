import Foundation

/// How a Browser Lane site authenticates. Only the Keychain strategy captures a
/// credential (into the macOS Keychain). Google/Microsoft SSO and manual sessions
/// are human handoffs — Browser Lane never automates or stores their credentials.
enum BrowserLaneAuthStrategy: String, CaseIterable {
    case keychainPassword = "keychain_password"
    case googleSso = "google_sso"
    case microsoftSso = "microsoft_sso"
    case manualSession = "manual_session"

    var label: String {
        switch self {
        case .keychainPassword: return "Keychain credentials"
        case .googleSso:        return "Google sign-in (SSO)"
        case .microsoftSso:     return "Microsoft sign-in (SSO)"
        case .manualSession:    return "Manual session"
        }
    }

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
    static let heyGen = BrowserLaneSite(
        id: "heygen",
        displayName: "HeyGen",
        homeUrl: "https://app.heygen.com/home",
        loginUrl: "https://app.heygen.com/login",
        allowedDomains: ["app.heygen.com", "heygen.com"],
        credentialRef: "hivematrix.browser.heygen.primary",
        authStrategy: BrowserLaneAuthStrategy.googleSso.rawValue,
        providerAccount: "",
        notes: "HeyGen portal video workflow.",
        lastSyncStatus: "not synced",
        createdAt: BrowserLaneSite.nowString(),
        updatedAt: BrowserLaneSite.nowString()
    )
}
