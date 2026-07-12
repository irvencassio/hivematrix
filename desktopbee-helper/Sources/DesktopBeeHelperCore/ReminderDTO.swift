// Pure, TCC-free reminder JSON encoding shared between the EventKit-backed
// CLI subcommand (Sources/DesktopBeeHelper/Reminders.swift, impure — lives in
// the executable target since EventKit itself can't be exercised in a unit
// test) and this library's test target.
//
// Mirrors CalendarEventDTO.swift's split exactly: kept side-effect free so it
// is testable without a Reminders TCC grant.

import Foundation

/// One reminder, already reduced to the exact JSON contract shape:
/// `{"title":string,"due"?:ISO-8601 string}`. `due` is omitted entirely (not
/// emitted as `null`) when the reminder has no due date — Swift's synthesized
/// Encodable calls encodeIfPresent for Optional stored properties, so a nil
/// `due` simply isn't written as a key. `due`, when present, is a
/// pre-formatted ISO-8601 string (produced by the caller via
/// ISO8601DateFormatter) rather than Date, same convention as
/// CalendarEventDTO's start/end.
public struct ReminderDTO: Codable, Equatable {
    public let title: String
    public let due: String?

    public init(title: String, due: String?) {
        self.title = title
        self.due = due
    }
}

public enum ReminderEncoding {
    /// Encodes an array of ReminderDTO to the exact `reminders list` JSON
    /// contract: a JSON array of objects with keys title/due (due omitted
    /// when absent). An empty array encodes to `[]`.
    public static func encodeRemindersJSON(_ reminders: [ReminderDTO]) throws -> Data {
        try JSONEncoder().encode(reminders)
    }
}
