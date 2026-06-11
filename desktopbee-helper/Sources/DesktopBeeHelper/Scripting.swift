// AppleScript/JXA execution — the most reliable strategy for scriptable apps.
// Highest-risk surface, so the contract tier is "approval" by default and the
// helper enforces an app allowlist before running anything.

import Foundation
import AppKit

enum Scripting {
    /// Run an AppleScript source string. `app` is advisory (for the audit log);
    /// the allowlist gate is applied by the caller in main.swift.
    static func run(_ source: String) -> Result<String, String> {
        var errorInfo: NSDictionary?
        guard let script = NSAppleScript(source: source) else {
            return .failure("could not compile AppleScript")
        }
        let descriptor = script.executeAndReturnError(&errorInfo)
        if let err = errorInfo {
            let msg = (err[NSAppleScript.errorMessage] as? String) ?? "unknown AppleScript error"
            return .failure(msg)
        }
        return .success(descriptor.stringValue ?? "")
    }
}
