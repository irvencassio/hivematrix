// Unit tests for the pure calendar-event JSON encoding used by
// `DesktopBeeHelper calendar today` (see Sources/DesktopBeeHelper/Calendar.swift).
//
// EventKit itself cannot be exercised in a SwiftPM unit test (no TCC grant in
// CI, and EKEventStore access would hang/deny). So the impure EventKit calls
// live in the executable target, and only the pure DTO + JSON-encoding step
// (this file's subject) is unit tested here, per the P0.1 plan.

import XCTest
@testable import DesktopBeeHelperCore

final class CalendarEventDTOTests: XCTestCase {
    func testEncodesKnownEventsArrayToExactContractShape() throws {
        let events = [
            CalendarEventDTO(
                title: "Standup",
                start: "2026-07-11T09:00:00Z",
                end: "2026-07-11T09:15:00Z",
                calendar: "Work",
                allDay: false
            ),
            CalendarEventDTO(
                title: "Vacation",
                start: "2026-07-11T00:00:00Z",
                end: "2026-07-12T00:00:00Z",
                calendar: "Personal",
                allDay: true
            ),
        ]

        let data = try CalendarEventEncoding.encodeEventsJSON(events)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let arr = try XCTUnwrap(parsed as? [[String: Any]])
        XCTAssertEqual(arr.count, 2)

        XCTAssertEqual(arr[0]["title"] as? String, "Standup")
        XCTAssertEqual(arr[0]["start"] as? String, "2026-07-11T09:00:00Z")
        XCTAssertEqual(arr[0]["end"] as? String, "2026-07-11T09:15:00Z")
        XCTAssertEqual(arr[0]["calendar"] as? String, "Work")
        XCTAssertEqual(arr[0]["allDay"] as? Bool, false)

        XCTAssertEqual(arr[1]["title"] as? String, "Vacation")
        XCTAssertEqual(arr[1]["start"] as? String, "2026-07-11T00:00:00Z")
        XCTAssertEqual(arr[1]["end"] as? String, "2026-07-12T00:00:00Z")
        XCTAssertEqual(arr[1]["calendar"] as? String, "Personal")
        XCTAssertEqual(arr[1]["allDay"] as? Bool, true)
    }

    func testEmptyArrayEncodesToEmptyJSONArray() throws {
        let data = try CalendarEventEncoding.encodeEventsJSON([])
        let str = String(data: data, encoding: .utf8)
        XCTAssertEqual(str, "[]")
    }

    func testISO8601StringsRoundTripThroughEncoding() throws {
        let formatter = ISO8601DateFormatter()
        let fixedInstant = Date(timeIntervalSince1970: 1_752_224_400)
        let iso = formatter.string(from: fixedInstant)

        let events = [
            CalendarEventDTO(title: "Fixed", start: iso, end: iso, calendar: "C", allDay: false)
        ]
        let data = try CalendarEventEncoding.encodeEventsJSON(events)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let arr = try XCTUnwrap(parsed as? [[String: Any]])

        let roundTripStart = try XCTUnwrap(arr[0]["start"] as? String)
        XCTAssertEqual(roundTripStart, iso)
        // Must actually be parseable as ISO-8601.
        XCTAssertNotNil(formatter.date(from: roundTripStart))
    }
}
