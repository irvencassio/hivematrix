// Screen capture for verification (not pixel-guessing). Captured IN-PROCESS so
// the helper's own Screen Recording TCC grant applies — shelling out to
// /usr/sbin/screencapture attributes the permission to that subprocess instead
// and fails. Writes a PNG to the audit directory; returns its path as captureRef.

import Foundation
import CoreGraphics
import AppKit

enum Capture {
    static var auditDir: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dir = "\(home)/.hivematrix/artifacts/desktopbee/captures"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Capture the main display to a PNG. Returns the file path on success.
    static func screen(tag: String) -> Result<String, String> {
        guard Permissions.screenRecordingAuthorized(prompt: false) else {
            return .failure("Screen Recording permission not granted")
        }
        let displayID = CGMainDisplayID()
        guard let image = CGDisplayCreateImage(displayID) else {
            return .failure("could not create image from display (Screen Recording permission?)")
        }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            return .failure("could not encode PNG")
        }
        let safeTag = tag.replacingOccurrences(of: "/", with: "_")
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let path = "\(auditDir)/\(stamp)-\(safeTag).png"
        do {
            try png.write(to: URL(fileURLWithPath: path))
            return .success(path)
        } catch {
            return .failure("write failed: \(error)")
        }
    }
}
