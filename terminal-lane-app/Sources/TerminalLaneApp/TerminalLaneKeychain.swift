import Foundation
import Security

enum TerminalLaneKeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case queryFailed(OSStatus)
    case deleteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Keychain save failed: \(Self.message(for: status))"
        case .queryFailed(let status):
            return "Keychain query failed: \(Self.message(for: status))"
        case .deleteFailed(let status):
            return "Keychain delete failed: \(Self.message(for: status))"
        }
    }

    private static func message(for status: OSStatus) -> String {
        (SecCopyErrorMessageString(status, nil) as String?) ?? "OSStatus \(status)"
    }
}

/// SSH passwords are Internet Password items keyed by host + user + port +
/// protocol — the same identity other SSH tools on this Mac use, so an item
/// already saved for user@host is found and reused. The profile's
/// credentialRef is a marker only; it never addresses the Keychain.
final class TerminalLaneKeychain {
    static let shared = TerminalLaneKeychain()
    static let labelPrefix = "HiveMatrix Terminal Lane"

    private func searchQuery(host: String, user: String, port: Int) -> [String: Any] {
        [
            kSecClass as String: kSecClassInternetPassword,
            kSecAttrServer as String: host,
            kSecAttrAccount as String: user,
            kSecAttrPort as String: port,
            kSecAttrProtocol as String: kSecAttrProtocolSSH,
        ]
    }

    /// Attribute-only existence check — never touches the secret data, so it
    /// works (and never prompts) even when the item's ACL excludes this app.
    func hasPassword(host: String, user: String, port: Int) -> Bool {
        var query = searchQuery(host: host, user: user, port: port)
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess
    }

    func savePassword(_ value: String, host: String, user: String, port: Int, displayName: String) throws {
        let data = Data(value.utf8)
        let search = searchQuery(host: host, user: user, port: port)
        let label = "\(Self.labelPrefix): \(displayName)"

        // Delete-then-add refreshes the ACL; may fail if an old ACL blocks this
        // binary, in which case the add reports a duplicate and we update in place.
        SecItemDelete(search as CFDictionary)

        var add = search
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = label

        if let access = permissiveAccess(label: label) {
            add[kSecAttrAccess as String] = access
        }

        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let update: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(search as CFDictionary, update as CFDictionary)
            if updateStatus != errSecSuccess { throw TerminalLaneKeychainError.saveFailed(updateStatus) }
        } else if status != errSecSuccess {
            throw TerminalLaneKeychainError.saveFailed(status)
        }
    }

    func deletePassword(host: String, user: String, port: Int) throws {
        let status = SecItemDelete(searchQuery(host: host, user: user, port: port) as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw TerminalLaneKeychainError.deleteFailed(status)
        }
    }

    /// SecAccess allowing any application to read the item without an
    /// authorization prompt. SPM executables change binary hash on every build,
    /// so the default per-app ACL would break after each rebuild — and the
    /// HiveMatrix daemon must read the same item. The item stays protected by
    /// the Keychain unlock itself.
    private func permissiveAccess(label: String) -> SecAccess? {
        var access: SecAccess?
        guard SecAccessCreate(label as CFString, nil, &access) == errSecSuccess,
              let access else { return nil }

        var aclList: CFArray?
        SecAccessCopyACLList(access, &aclList)
        guard let acls = aclList as? [SecACL] else { return access }

        for acl in acls {
            var appList: CFArray?
            var description: CFString?
            var promptSelector = SecKeychainPromptSelector()
            SecACLCopyContents(acl, &appList, &description, &promptSelector)
            // nil trusted-app list = any application can access without prompting
            SecACLSetContents(acl, nil, description ?? "" as CFString, promptSelector)
        }

        return access
    }
}
