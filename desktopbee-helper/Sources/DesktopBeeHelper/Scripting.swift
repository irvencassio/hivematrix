// AppleScript/JXA execution — the most reliable strategy for scriptable apps.
// Highest-risk surface, so the contract tier is "approval" by default and the
// helper enforces an app allowlist before running anything.

import Foundation
import AppKit

enum Scripting {
    /// Run an AppleScript source string. `app` is advisory (for the audit log);
    /// the allowlist gate is applied by the caller in main.swift.
    static func run(_ source: String) -> Result<String, String> {
        // Hard-gate the AppleScript→shell escape. `do shell script` (and the
        // `do script`/`system attribute`-style escapes) turn app automation into
        // arbitrary code execution regardless of the target-app allowlist, so
        // reject any script that contains it. script.run is for app automation.
        let lowered = source.lowercased()
        for forbidden in ["do shell script", "system attribute", "do script"] {
            if lowered.contains(forbidden) {
                return .failure("blocked: AppleScript may not contain '\(forbidden)' (shell escape not permitted)")
            }
        }
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
