import Foundation

struct BrowserLaneSite: Codable, Equatable {
    var id: String
    var displayName: String
    var homeUrl: String
    var loginUrl: String
    var allowedDomains: [String]
    var credentialRef: String
    var authStrategy: String
    var notes: String
    var lastSyncStatus: String
    var createdAt: String
    var updatedAt: String

    static func nowString() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    var primaryDomain: String {
        allowedDomains.first ?? URL(string: homeUrl)?.host ?? id
    }
}

extension BrowserLaneSite {
    static let heyGen = BrowserLaneSite(
        id: "heygen",
        displayName: "HeyGen",
        homeUrl: "https://app.heygen.com/home",
        loginUrl: "https://app.heygen.com/login",
        allowedDomains: ["app.heygen.com", "heygen.com"],
        credentialRef: "hivematrix.browser.heygen.primary",
        authStrategy: "keychain_password",
        notes: "HeyGen portal video workflow.",
        lastSyncStatus: "not synced",
        createdAt: BrowserLaneSite.nowString(),
        updatedAt: BrowserLaneSite.nowString()
    )
}
