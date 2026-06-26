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
}
