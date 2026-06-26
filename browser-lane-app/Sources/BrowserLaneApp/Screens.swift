import AppKit

enum Screen: Int, CaseIterable {
    case browser, sites, addSite, readiness, traces, settings

    var title: String {
        switch self {
        case .browser:   return "Browser"
        case .sites:     return "Sites"
        case .addSite:   return "Add Site"
        case .readiness: return "Readiness"
        case .traces:    return "Traces"
        case .settings:  return "Settings"
        }
    }

    var subtitle: String {
        switch self {
        case .browser:   return "Search Google or open a URL in Browser Lane."
        case .sites:     return "Authenticated sites managed by Browser Lane."
        case .addSite:   return "Register a new site with display name, login URL, and Keychain credential ref."
        case .readiness: return "Daily authentication readiness results per site."
        case .traces:    return "Browser session trace events and audit history."
        case .settings:  return "Browser Lane appearance, web defaults, daemon connection, storage, and about."
        }
    }

    var placeholder: String {
        switch self {
        case .browser:
            return "Enter a search or URL above. Browser Lane uses a native WebKit view for this MVP."
        case .sites:
            return "No sites configured. Use Add Site to register HeyGen or another authenticated site."
        case .addSite:
            return "Save site metadata and put username/password in macOS Keychain only."
        case .readiness:
            return "No readiness runs. Use hive browser readiness run --all to probe configured sites."
        case .traces:
            return "No trace events. Trace data is written each time a readiness probe or browser workflow runs."
        case .settings:
            return "Adjust icon state, default URL, daemon URL, storage metadata, and view version info."
        }
    }

    var iconName: String {
        switch self {
        case .browser:   return "safari"
        case .sites:     return "globe"
        case .addSite:   return "plus.circle"
        case .readiness: return "checkmark.shield"
        case .traces:    return "list.bullet.rectangle"
        case .settings:  return "gearshape"
        }
    }
}
