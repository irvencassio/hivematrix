import XCTest
@testable import TerminalLaneCore

final class CommandPolicyTests: XCTestCase {
    let policy = CommandPolicy.defaults

    func testReadwriteAllowsNormalCommands() {
        XCTAssertEqual(policy.decide(commandLine: "rm -rf /tmp/x", mode: .readwrite), .allow)
        XCTAssertEqual(policy.decide(commandLine: "cat /etc/hosts", mode: .readwrite), .allow)
    }

    func testBlocklistAppliesInEveryMode() {
        if case .blocked = policy.decide(commandLine: "shutdown -h now", mode: .readwrite) {} else { XCTFail("shutdown must block in readwrite") }
        if case .blocked = policy.decide(commandLine: "sudo reboot", mode: .readonly) {} else { XCTFail("sudo reboot must block") }
        if case .blocked = policy.decide(commandLine: "/sbin/poweroff", mode: .readwrite) {} else { XCTFail("absolute-path poweroff must block") }
    }

    func testReadonlyAllowsAllowlistedOnly() {
        XCTAssertEqual(policy.decide(commandLine: "uptime", mode: .readonly), .allow)
        XCTAssertEqual(policy.decide(commandLine: "cat /var/log/syslog", mode: .readonly), .allow)
        if case .blocked = policy.decide(commandLine: "rm file", mode: .readonly) {} else { XCTFail("rm must block in readonly") }
        if case .blocked = policy.decide(commandLine: "./deploy.sh", mode: .readonly) {} else { XCTFail("unknown cmd must block in readonly") }
    }

    func testEveryChainSegmentIsChecked() {
        if case .blocked = policy.decide(commandLine: "cat x && rm y", mode: .readonly) {} else { XCTFail("write in a chain must block") }
        if case .blocked = policy.decide(commandLine: "cat x | tee y", mode: .readonly) {} else { XCTFail("tee not allowlisted → block") }
        XCTAssertEqual(policy.decide(commandLine: "cat x | grep y | wc -l", mode: .readonly), .allow)
    }

    func testEnvAssignmentPrefixStripped() {
        if case .blocked = policy.decide(commandLine: "FOO=bar rm z", mode: .readonly) {} else { XCTFail("env-prefixed rm must block") }
        XCTAssertEqual(policy.decide(commandLine: "LANG=C cat z", mode: .readonly), .allow)
    }

    func testEmptyIsAllowed() {
        XCTAssertEqual(policy.decide(commandLine: "   ", mode: .readonly), .allow)
        XCTAssertEqual(policy.decide(commandLine: "", mode: .readonly), .allow)
    }
}
