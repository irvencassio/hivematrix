// Pure, TCC-free calendar-event JSON encoding shared between the
// EventKit-backed CLI subcommand (Sources/DesktopBeeHelper/Calendar.swift,
// impure — lives in the executable target since EventKit itself can't be
// exercised in a unit test) and this library's test target.
//
// Kept side-effect free so it is testable without a Calendar TCC grant.

import Foundation

/// One calendar event, already reduced to the exact JSON contract shape:
/// `{"title":string,"start":ISO-8601 string,"end":ISO-8601 string,"calendar":string,"allDay":bool}`.
/// `start`/`end` are pre-formatted ISO-8601 strings (produced by the caller
/// via ISO8601DateFormatter) rather than Date, so this type carries no
/// date-formatting policy of its own — only the JSON shape.
public struct CalendarEventDTO: Codable, Equatable {
    public let title: String
    public let start: String
    public let end: String
    public let calendar: String
    public let allDay: Bool

    public init(title: String, start: String, end: String, calendar: String, allDay: Bool) {
        self.title = title
        self.start = start
        self.end = end
        self.calendar = calendar
        self.allDay = allDay
    }
}

public enum CalendarEventEncoding {
    /// Encodes an array of CalendarEventDTO to the exact `calendar today`
    /// JSON contract: a JSON array of objects with keys title/start/end/
    /// calendar/allDay. An empty array encodes to `[]`.
    public static func encodeEventsJSON(_ events: [CalendarEventDTO]) throws -> Data {
        try JSONEncoder().encode(events)
    }
}
