// Unit tests for the pure reminder JSON encoding used by
// `DesktopBeeHelper reminders list` (see Sources/DesktopBeeHelper/Reminders.swift).
//
// EventKit itself cannot be exercised in a SwiftPM unit test (no TCC grant in
// CI, and EKEventStore access would hang/deny). So the impure EventKit calls
// live in the executable target, and only the pure DTO + JSON-encoding step
// (this file's subject) is unit tested here, mirroring CalendarEventDTOTests.

import XCTest
@testable import DesktopBeeHelperCore

final class ReminderDTOTests: XCTestCase {
    func testEncodesKnownRemindersArrayToExactContractShape() throws {
        let reminders = [
            ReminderDTO(title: "Call mom", due: "2026-07-13T22:00:00Z"),
            ReminderDTO(title: "Buy milk", due: nil),
        ]

        let data = try ReminderEncoding.encodeRemindersJSON(reminders)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let arr = try XCTUnwrap(parsed as? [[String: Any]])
        XCTAssertEqual(arr.count, 2)

        XCTAssertEqual(arr[0]["title"] as? String, "Call mom")
        XCTAssertEqual(arr[0]["due"] as? String, "2026-07-13T22:00:00Z")

        XCTAssertEqual(arr[1]["title"] as? String, "Buy milk")
        // No due date -> the key must be OMITTED, not emitted as null.
        XCTAssertNil(arr[1]["due"])
        XCTAssertFalse(arr[1].keys.contains("due"))
    }

    func testEmptyArrayEncodesToEmptyJSONArray() throws {
        let data = try ReminderEncoding.encodeRemindersJSON([])
        let str = String(data: data, encoding: .utf8)
        XCTAssertEqual(str, "[]")
    }

    func testISO8601StringsRoundTripThroughEncoding() throws {
        let formatter = ISO8601DateFormatter()
        let fixedInstant = Date(timeIntervalSince1970: 1_752_224_400)
        let iso = formatter.string(from: fixedInstant)

        let reminders = [ReminderDTO(title: "Fixed", due: iso)]
        let data = try ReminderEncoding.encodeRemindersJSON(reminders)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let arr = try XCTUnwrap(parsed as? [[String: Any]])

        let roundTripDue = try XCTUnwrap(arr[0]["due"] as? String)
        XCTAssertEqual(roundTripDue, iso)
        XCTAssertNotNil(formatter.date(from: roundTripDue))
    }
}
