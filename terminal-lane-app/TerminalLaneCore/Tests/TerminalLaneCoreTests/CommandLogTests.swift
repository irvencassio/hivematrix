import XCTest
@testable import TerminalLaneCore

final class CommandLogTests: XCTestCase {
    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tlcore-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testFormattedIsTabDelimitedSingleLine() {
        let ts = Date(timeIntervalSince1970: 1_770_000_000)
        let e = CommandLogEntry(timestamp: ts, server: "aiserver", ip: "10.80.114.11", mode: "readonly", decision: "BLOCKED", command: "rm -rf\n/tmp")
        let parts = e.formatted().components(separatedBy: "\t")
        XCTAssertEqual(parts.count, 6)
        XCTAssertEqual(parts[1], "aiserver")
        XCTAssertEqual(parts[4], "BLOCKED")
        XCTAssertFalse(parts[5].contains("\n"))
    }

    func testAppendWritesAndRecentTextReadsBack() {
        let dir = tempDir()
        let log = CommandLog(directory: dir)
        log.append(CommandLogEntry(timestamp: Date(timeIntervalSince1970: 1), server: "s", ip: "1.1.1.1", mode: "readwrite", decision: "RAN", command: "uptime"))
        XCTAssertTrue(log.recentText().contains("uptime"))
    }

    func testRotationCapsFileCount() {
        let dir = tempDir()
        let log = CommandLog(directory: dir, maxBytes: 200, maxFiles: 5)
        for i in 0..<500 {
            log.append(CommandLogEntry(timestamp: Date(timeIntervalSince1970: Double(i)), server: "s", ip: "1.1.1.1", mode: "readwrite", decision: "RAN", command: "command-number-\(i)"))
        }
        let files = try! FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix("commands") }
        // commands.log + commands.1..commands.5 at most
        XCTAssertLessThanOrEqual(files.count, 6)
        XCTAssertTrue(files.contains("commands.log"))
        XCTAssertFalse(files.contains("commands.6.log"))
    }
}
