// Calendar subcommand: `DesktopBeeHelper calendar today [--limit N]` and
// `DesktopBeeHelper calendar create --title T --start ISO --end ISO
// [--calendar NAME]`.
//
// Uses EventKit (EKEventStore) exclusively — never AppleScript / `tell
// application "Calendar"` — so this path does NOT launch Calendar.app and
// gets its own clean TCC prompt attributed to this helper binary (see
// NSCalendarsFullAccessUsageDescription in Resources/Info.plist). This is
// the fix for the old `calendar_today` osascript path, which launched
// Calendar.app and was refused (no Automation TCC grant).
//
// The JSON *encoding* of results is a pure function that lives in
// DesktopBeeHelperCore (CalendarEventDTO / CalendarEventEncoding) so it can
// be unit tested without EventKit/TCC; this file only does the impure
// EventKit calls and wires them into that pure encoder.
//
// Manual smoke test (not automatable — no TCC in CI):
//   1. swift build
//   2. .build/debug/DesktopBeeHelper calendar today
//      - First run triggers the "HiveMatrix Desktop Lane Helper wants to
//        access your Calendar" system TCC prompt. Calendar.app must NOT
//        open at any point during this.
//      - Approve → stdout prints today's events as a JSON array (empty
//        array if none), exit code 0.
//      - Deny (or previously denied via System Settings ▸ Privacy &
//        Security ▸ Calendars) → stdout prints {"error":"permission"},
//        exit code 77.
//   3. .build/debug/DesktopBeeHelper calendar create --title "Test Event" \
//        --start 2026-07-11T20:00:00Z --end 2026-07-11T20:30:00Z
//      → creates an event in the default calendar, stdout prints
//        {"ok":true,"id":"<eventIdentifier>"}, exit code 0. Verify the
//        event appears in Calendar.app (opening the app to look is fine;
//        the helper itself must not have launched it).

import Foundation
import EventKit
import DesktopBeeHelperCore

enum CalendarCLI {
    static let permissionExitCode: Int32 = 77

    struct CLIError: Error {
        let message: String
    }

    /// Parses `--key value` pairs from argv (already stripped of the
    /// leading `calendar <subcommand>` tokens). A flag with no following
    /// value (or one followed by another flag) is recorded as "true".
    static func parseFlags(_ args: [String]) -> [String: String] {
        var out: [String: String] = [:]
        var i = 0
        while i < args.count {
            let a = args[i]
            if a.hasPrefix("--") {
                let key = String(a.dropFirst(2))
                if i + 1 < args.count, !args[i + 1].hasPrefix("--") {
                    out[key] = args[i + 1]
                    i += 2
                } else {
                    out[key] = "true"
                    i += 1
                }
            } else {
                i += 1
            }
        }
        return out
    }

    static func printJSONObject(_ obj: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        } else {
            print("{}")
        }
    }

    static func printJSONData(_ data: Data) {
        print(String(data: data, encoding: .utf8) ?? "[]")
    }

    /// Synchronously requests full calendar access, blocking on a semaphore.
    /// A CLI subcommand run has no RunLoop spinning, so this must not return
    /// until the (possibly async, TCC-prompting) completion has fired.
    static func requestFullAccess(_ store: EKEventStore) -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var granted = false
        store.requestFullAccessToEvents { ok, _ in
            granted = ok
            sem.signal()
        }
        sem.wait()
        return granted
    }

    /// True only when access is definitively unusable: the grant callback
    /// reported false, or the authorization status is denied/restricted.
    /// (notDetermined/fullAccess after a successful grant are fine.)
    static func accessDenied(granted: Bool, store: EKEventStore) -> Bool {
        if !granted { return true }
        let status = EKEventStore.authorizationStatus(for: .event)
        return status == .denied || status == .restricted
    }

    /// Entry point for `calendar <sub> [...]`. Exits the process; never
    /// returns, and never starts the HTTP daemon.
    static func run(_ args: [String]) -> Never {
        guard let sub = args.first else {
            printJSONObject(["error": "usage: calendar <today|create> [...]"])
            exit(1)
        }
        let rest = Array(args.dropFirst())
        let store = EKEventStore()

        let granted = requestFullAccess(store)
        if accessDenied(granted: granted, store: store) {
            printJSONObject(["error": "permission"])
            exit(permissionExitCode)
        }

        do {
            switch sub {
            case "today":
                let flags = parseFlags(rest)
                let requestedLimit = flags["limit"].flatMap { Int($0) } ?? 8
                let limit = min(max(requestedLimit, 1), 20)
                let data = try encodeTodayEventsJSON(store: store, limit: limit)
                printJSONData(data)
                exit(0)

            case "create":
                let flags = parseFlags(rest)
                guard let title = flags["title"], let startStr = flags["start"], let endStr = flags["end"] else {
                    throw CLIError(message: "usage: calendar create --title T --start ISO --end ISO [--calendar name]")
                }
                guard let start = parseISO8601Flexible(startStr) else {
                    throw CLIError(message: "--start must be ISO-8601: \(startStr)")
                }
                guard let end = parseISO8601Flexible(endStr) else {
                    throw CLIError(message: "--end must be ISO-8601: \(endStr)")
                }
                let id = try createEvent(store: store, title: title, start: start, end: end, calendarName: flags["calendar"])
                printJSONObject(["ok": true, "id": id])
                exit(0)

            default:
                printJSONObject(["error": "unknown calendar subcommand '\(sub)'"])
                exit(1)
            }
        } catch let e as CLIError {
            printJSONObject(["error": e.message])
            exit(1)
        } catch {
            printJSONObject(["error": "\(error)"])
            exit(1)
        }
    }

    /// Fetches today's events (local midnight to next local midnight),
    /// sorts by start ascending, applies `limit`, and encodes via the pure
    /// DesktopBeeHelperCore encoder.
    static func encodeTodayEventsJSON(store: EKEventStore, limit: Int) throws -> Data {
        let cal = Calendar.current
        let now = Date()
        let startOfDay = cal.startOfDay(for: now)
        guard let startOfNextDay = cal.date(byAdding: .day, value: 1, to: startOfDay) else {
            throw CLIError(message: "failed to compute day boundary")
        }

        let predicate = store.predicateForEvents(withStart: startOfDay, end: startOfNextDay, calendars: nil)
        let events = store.events(matching: predicate)

        let iso = ISO8601DateFormatter()
        let dtos: [CalendarEventDTO] = events
            .sorted { eventStart($0) < eventStart($1) }
            .prefix(limit)
            .map { ev in
                CalendarEventDTO(
                    title: ev.title ?? "",
                    start: iso.string(from: eventStart(ev)),
                    end: iso.string(from: eventEnd(ev)),
                    calendar: ev.calendar?.title ?? "",
                    allDay: ev.isAllDay
                )
            }
        return try CalendarEventEncoding.encodeEventsJSON(dtos)
    }

    private static func eventStart(_ ev: EKEvent) -> Date {
        ev.startDate ?? .distantPast
    }

    private static func eventEnd(_ ev: EKEvent) -> Date {
        ev.endDate ?? ev.startDate ?? .distantPast
    }

    /// Creates one event on the named calendar (matched by title) or, if
    /// none is given, `defaultCalendarForNewEvents`.
    static func createEvent(store: EKEventStore, title: String, start: Date, end: Date, calendarName: String?) throws -> String {
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end

        if let calendarName {
            guard let match = store.calendars(for: .event).first(where: { $0.title == calendarName }) else {
                throw CLIError(message: "calendar not found: \(calendarName)")
            }
            event.calendar = match
        } else {
            guard let def = store.defaultCalendarForNewEvents else {
                throw CLIError(message: "no default calendar for new events")
            }
            event.calendar = def
        }

        try store.save(event, span: .thisEvent)
        return event.eventIdentifier ?? ""
    }
}
