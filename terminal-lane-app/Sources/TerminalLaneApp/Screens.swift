import AppKit

enum TerminalLaneScreen: String, CaseIterable {
    case terminal, profiles, addProfile, readiness, traces, settings

    var title: String {
        switch self {
        case .terminal: return "Terminal"
        case .profiles: return "Profiles"
        case .addProfile: return "Add Profile"
        case .readiness: return "Readiness"
        case .traces: return "Traces"
        case .settings: return "Settings"
        }
    }

    /// SF Symbol name shown beside each sidebar item.
    var symbolName: String {
        switch self {
        case .terminal: return "terminal"
        case .profiles: return "list.bullet.rectangle"
        case .addProfile: return "plus.circle"
        case .readiness: return "checkmark.seal"
        case .traces: return "scroll"
        case .settings: return "gearshape"
        }
    }
}
