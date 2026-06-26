import AppKit
import Foundation

enum BrowserLaneIconState: String, CaseIterable {
    case darkGreen
    case white

    var label: String {
        switch self {
        case .darkGreen: return "Dark green"
        case .white: return "White"
        }
    }

    var resourceName: String {
        switch self {
        case .darkGreen: return "BrowserLane"
        case .white: return "BrowserLaneWhite"
        }
    }
}

final class BrowserLaneSettings {
    static let shared = BrowserLaneSettings()

    private let defaults = UserDefaults.standard

    var iconState: BrowserLaneIconState {
        get { BrowserLaneIconState(rawValue: defaults.string(forKey: "iconState") ?? "") ?? .darkGreen }
        set {
            defaults.set(newValue.rawValue, forKey: "iconState")
            applyIconState()
        }
    }

    var defaultURL: String {
        get { defaults.string(forKey: "defaultURL") ?? "https://www.google.com" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "defaultURL") }
    }

    var daemonURL: String {
        get { defaults.string(forKey: "daemonURL") ?? "http://127.0.0.1:3747" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "daemonURL") }
    }

    var tokenPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
            .path
    }

    var siteMetadataPath: String {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Browser Lane", isDirectory: true)
            .appendingPathComponent("sites.json")
            .path
    }

    func applyIconState() {
        let name = iconState.resourceName
        let image = Bundle.main.url(forResource: name, withExtension: "icns").flatMap { NSImage(contentsOf: $0) }
        if let image {
            NSApplication.shared.applicationIconImage = image
        }
    }
}
