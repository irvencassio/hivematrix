// Permission checks + prompt triggers for the dangerous macOS surfaces.
//
// Accessibility (AXIsProcessTrusted) gates AX query/act and CGEvent input.
// Screen Recording gates screen capture. Both are per-binary TCC grants; the
// helper triggers the system prompt on demand and reports status so HiveMatrix
// can surface "Desktop Lane needs permission" in the console.

import Foundation
import ApplicationServices
import CoreGraphics

enum Permissions {
    /// Accessibility trust. Pass prompt=true to surface the system dialog
    /// (adds the helper to System Settings ▸ Privacy ▸ Accessibility).
    static func accessibilityTrusted(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Screen Recording authorization. Calling CGRequestScreenCaptureAccess()
    /// surfaces the system prompt the first time and returns current status.
    static func screenRecordingAuthorized(prompt: Bool) -> Bool {
        if prompt {
            return CGRequestScreenCaptureAccess()
        }
        return CGPreflightScreenCaptureAccess()
    }

    static func snapshot(prompt: Bool) -> [String: Any] {
        return [
            "accessibility": accessibilityTrusted(prompt: prompt),
            "screenRecording": screenRecordingAuthorized(prompt: prompt),
        ]
    }
}
