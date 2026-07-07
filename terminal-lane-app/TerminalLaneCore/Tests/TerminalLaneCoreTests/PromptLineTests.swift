import XCTest
@testable import TerminalLaneCore

final class PromptLineTests: XCTestCase {
    func testStripsPromptPrefix() {
        XCTAssertEqual(PromptLine.command(from: "me@host:~$ uptime"), "uptime")
        XCTAssertEqual(PromptLine.command(from: "❯ cat file"), "cat file")
        XCTAssertEqual(PromptLine.command(from: "root@box:/# ls"), "ls")
    }
    func testTypedMarkerAfterCommandCannotHideIt() {
        XCTAssertEqual(PromptLine.command(from: "me@host:~$ rm x $ cat"), "rm x $ cat")
        XCTAssertEqual(PromptLine.command(from: "me@host:~$ echo a > b"), "echo a > b")
    }
    func testNoPromptReturnsTrimmedLine() {
        XCTAssertEqual(PromptLine.command(from: "  bareword  "), "bareword")
    }
}
