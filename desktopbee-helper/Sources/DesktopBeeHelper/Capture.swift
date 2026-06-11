// Screen capture for verification (not pixel-guessing). Uses the system
// `screencapture` tool — robust across macOS versions and gated by the Screen
// Recording TCC grant on the helper. Writes a PNG to the audit directory and
// returns its path as captureRef.

import Foundation

enum Capture {
    static var auditDir: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dir = "\(home)/.hivematrix/artifacts/desktopbee/captures"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Capture the full screen (or a specific window owner is a future option).
    /// Returns the file path on success.
    static func screen(tag: String) -> Result<String, String> {
        let safeTag = tag.replacingOccurrences(of: "/", with: "_")
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let path = "\(auditDir)/\(stamp)-\(safeTag).png"

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        // -x: no sound, -o: no window shadow, -t png
        proc.arguments = ["-x", "-o", "-t", "png", path]
        let errPipe = Pipe()
        proc.standardError = errPipe
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return .failure("screencapture failed to launch: \(error)")
        }
        if proc.terminationStatus != 0 {
            let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            return .failure("screencapture exited \(proc.terminationStatus): \(err)")
        }
        guard FileManager.default.fileExists(atPath: path) else {
            return .failure("capture produced no file (Screen Recording permission?)")
        }
        return .success(path)
    }
}
