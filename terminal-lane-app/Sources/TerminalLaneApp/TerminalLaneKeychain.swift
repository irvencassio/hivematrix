import Foundation
import Security

enum TerminalLaneKeychainError: LocalizedError {
    case invalidCredentialRef
    case keychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidCredentialRef:
            return "Credential ref must start with hivematrix.terminal."
        case .keychainStatus(let status):
            if let message = SecCopyErrorMessageString(status, nil) as String? { return message }
            return "Keychain error \(status)"
        }
    }
}

final class TerminalLaneKeychain {
    static let shared = TerminalLaneKeychain()
    static let service = "HiveMatrix Terminal Lane"

    func saveCredential(profileId: String, credentialRef: String, value: String) throws {
        guard credentialRef.hasPrefix("hivematrix.terminal.") else { throw TerminalLaneKeychainError.invalidCredentialRef }
        let data = Data(value.utf8)
        let account = "\(profileId):credential"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: TerminalLaneKeychain.service,
            kSecAttrAccount as String: account,
        ]
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound { throw TerminalLaneKeychainError.keychainStatus(updateStatus) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus != errSecSuccess { throw TerminalLaneKeychainError.keychainStatus(addStatus) }
    }
}
