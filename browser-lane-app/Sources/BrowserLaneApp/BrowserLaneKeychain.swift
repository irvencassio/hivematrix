import Foundation
import Security

enum BrowserLaneKeychainError: LocalizedError {
    case invalidCredentialRef
    case keychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidCredentialRef:
            return "Credential ref must start with hivematrix.browser."
        case .keychainStatus(let status):
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                return message
            }
            return "Keychain error \(status)"
        }
    }
}

final class BrowserLaneKeychain {
    static let shared = BrowserLaneKeychain()
    static let service = "HiveMatrix Browser Lane"

    func saveCredential(siteId: String, credentialRef: String, username: String, password: String) throws {
        guard credentialRef.hasPrefix("hivematrix.browser.") else {
            throw BrowserLaneKeychainError.invalidCredentialRef
        }
        try saveSecret(account: "\(siteId):username", value: username)
        try saveSecret(account: "\(siteId):password", value: password)
    }

    /// Remove a site's stored credential pair. Safe to call when nothing is stored.
    func deleteCredential(siteId: String) {
        for account in ["\(siteId):username", "\(siteId):password"] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: BrowserLaneKeychain.service,
                kSecAttrAccount as String: account,
            ]
            SecItemDelete(query as CFDictionary)
        }
    }

    private func saveSecret(account: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: BrowserLaneKeychain.service,
            kSecAttrAccount as String: account,
        ]
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw BrowserLaneKeychainError.keychainStatus(updateStatus)
        }

        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw BrowserLaneKeychainError.keychainStatus(addStatus)
        }
    }
}
