import AppKit

/// Content-area screens. Sites are NOT a screen — they are the sidebar, and the
/// Command Log is not a screen either — it is the right panel. What is left here
/// is what the toolbar and the sidebar's "+" open.
enum Screen: Int, CaseIterable {
    case browser, addSite, readiness, settings

    var title: String {
        switch self {
        case .browser:   return "Browser"
        case .addSite:   return "New Site"
        case .readiness: return "Readiness"
        case .settings:  return "Settings"
        }
    }

    var subtitle: String {
        switch self {
        case .browser:   return "Search Google or open a URL in Browser Lane."
        case .addSite:   return "Add a website and how it signs in. Sign-in happens in the browser; passwords stay in your macOS Keychain."
        case .readiness: return "Daily authentication readiness results per site."
        case .settings:  return "Browser Lane appearance, web defaults, daemon connection, storage, and about."
        }
    }

    var placeholder: String {
        switch self {
        case .browser:
            return "Enter a search or URL above. Browser Lane uses a native WebKit view for this MVP."
        case .addSite:
            return "Save the site and keep any username + password in the macOS Keychain only."
        case .readiness:
            return "No readiness runs. Use hive browser readiness run --all to probe configured sites."
        case .settings:
            return "Adjust icon state, default URL, daemon URL, storage location, and view version info."
        }
    }

    var iconName: String {
        switch self {
        case .browser:   return "safari"
        case .addSite:   return "plus.circle"
        case .readiness: return "checkmark.shield"
        case .settings:  return "gearshape"
        }
    }
}
