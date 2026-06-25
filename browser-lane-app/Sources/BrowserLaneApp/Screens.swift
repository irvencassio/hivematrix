import AppKit

enum Screen: Int, CaseIterable {
    case browser, sites, addSite, readiness, traces

    var title: String {
        switch self {
        case .browser:   return "Browser"
        case .sites:     return "Sites"
        case .addSite:   return "Add Site"
        case .readiness: return "Readiness"
        case .traces:    return "Traces"
        }
    }

    var subtitle: String {
        switch self {
        case .browser:   return "Search Google or open a URL in Browser Lane."
        case .sites:     return "Authenticated sites managed by Browser Lane."
        case .addSite:   return "Register a new site with display name, login URL, and Keychain credential ref."
        case .readiness: return "Daily authentication readiness results per site."
        case .traces:    return "Browser session trace events and audit history."
        }
    }

    var placeholder: String {
        switch self {
        case .browser:
            return "Enter a search or URL above. Browser Lane uses a native WebKit view for this MVP."
        case .sites:
            return "No sites configured. Use hive browser sites add to register the first site."
        case .addSite:
            return "Site registration is not wired yet. Credentials are stored in macOS Keychain only — never in SQLite or logs."
        case .readiness:
            return "No readiness runs. Use hive browser readiness run --all to probe configured sites."
        case .traces:
            return "No trace events. Trace data is written each time a readiness probe or browser workflow runs."
        }
    }

    var iconName: String {
        switch self {
        case .browser:   return "safari"
        case .sites:     return "globe"
        case .addSite:   return "plus.circle"
        case .readiness: return "checkmark.shield"
        case .traces:    return "list.bullet.rectangle"
        }
    }
}
