// Reminders subcommand: `DesktopBeeHelper reminders list [--limit N]` and
// `DesktopBeeHelper reminders create --name X [--due ISO]`.
//
// Uses EventKit (EKEventStore) exclusively — never AppleScript / `tell
// application "Reminders"` — so this path does NOT launch Reminders.app and
// gets its own clean TCC prompt attributed to this helper binary (see
// NSRemindersFullAccessUsageDescription in Resources/Info.plist). This is the
// same fix, for Reminders, as Calendar.swift already applied for Calendar:
// the old osascript `reminders_list`/`reminder_create` path launched
// Reminders.app and was refused (no Automation TCC grant) when driven
// headlessly from the daemon.
//
// Mirrors Calendar.swift's structure and exit-code contract exactly (see that
// file's header comment) so pim-tools.ts's existing helper classifier
// (permission / HELPER_TIMEOUT_CODE / stale-helper) works unmodified for
// reminders too. The JSON *encoding* of results is a pure function that lives
// in DesktopBeeHelperCore (ReminderDTO / ReminderEncoding) so it can be unit
// tested without EventKit/TCC; this file only does the impure EventKit calls
// and wires them into that pure encoder.
//
// Manual smoke test (not automatable — no TCC in CI):
//   1. swift build
//   2. .build/debug/DesktopBeeHelper reminders list
//      - First run triggers the "HiveMatrix Desktop Lane Helper wants to
//        access your Reminders" system TCC prompt (separate grant from
//        Calendars). Reminders.app must NOT open at any point during this.
//      - Approve → stdout prints open reminders as a JSON array (empty array
//        if none), exit code 0.
//      - Deny (or previously denied via System Settings ▸ Privacy &
//        Security ▸ Reminders) → stdout prints {"error":"permission"},
//        exit code 77.
//   3. .build/debug/DesktopBeeHelper reminders create --name "Call mom" \
//        --due 2026-07-13T22:00:00Z
//      → creates a reminder on the default reminders list, stdout prints
//        {"ok":true,"id":"<calendarItemIdentifier>"}, exit code 0. Verify the
//        reminder appears in Reminders.app (opening the app to look is fine;
//        the helper itself must not have launched it).

import Foundation
import EventKit
import DesktopBeeHelperCore

enum RemindersCLI {
    static let permissionExitCode: Int32 = 77

    struct CLIError: Error {
        let message: String
    }

    /// Parses `--key value` pairs from argv (already stripped of the leading
    /// `reminders <subcommand>` tokens). A flag with no following value (or
    /// one followed by another flag) is recorded as "true". Duplicated here
    /// (rather than shared with CalendarCLI) so each subcommand handler stays
    /// self-contained, matching Calendar.swift's own copy.
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

    /// Synchronously requests full reminders access, blocking on a semaphore.
    /// A CLI subcommand run has no RunLoop spinning, so this must not return
    /// until the (possibly async, TCC-prompting) completion has fired.
    static func requestFullAccess(_ store: EKEventStore) -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var granted = false
        store.requestFullAccessToReminders { ok, _ in
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
        let status = EKEventStore.authorizationStatus(for: .reminder)
        return status == .denied || status == .restricted
    }

    /// Entry point for `reminders <sub> [...]`. Exits the process; never
    /// returns, and never starts the HTTP daemon.
    static func run(_ args: [String]) -> Never {
        guard let sub = args.first else {
            printJSONObject(["error": "usage: reminders <list|create> [...]"])
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
            case "list":
                let flags = parseFlags(rest)
                let requestedLimit = flags["limit"].flatMap { Int($0) } ?? 10
                let limit = min(max(requestedLimit, 1), 20)
                let data = try encodeIncompleteRemindersJSON(store: store, limit: limit)
                printJSONData(data)
                exit(0)

            case "create":
                let flags = parseFlags(rest)
                guard let name = flags["name"] else {
                    throw CLIError(message: "usage: reminders create --name X [--due ISO]")
                }
                var due: Date? = nil
                if let dueStr = flags["due"] {
                    let formatter = ISO8601DateFormatter()
                    guard let d = formatter.date(from: dueStr) else {
                        throw CLIError(message: "--due must be ISO-8601: \(dueStr)")
                    }
                    due = d
                }
                let id = try createReminder(store: store, name: name, due: due)
                printJSONObject(["ok": true, "id": id])
                exit(0)

            default:
                printJSONObject(["error": "unknown reminders subcommand '\(sub)'"])
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

    /// Fetches all incomplete reminders (with or without a due date) across
    /// every reminders list, sorts by due date ascending (reminders with no
    /// due date sort last), applies `limit`, and encodes via the pure
    /// DesktopBeeHelperCore encoder.
    static func encodeIncompleteRemindersJSON(store: EKEventStore, limit: Int) throws -> Data {
        let reminders = try fetchIncompleteReminders(store: store)

        let iso = ISO8601DateFormatter()
        let dtos: [ReminderDTO] = reminders
            .sorted { dueDate($0) ?? .distantFuture < (dueDate($1) ?? .distantFuture) }
            .prefix(limit)
            .map { r in
                ReminderDTO(
                    title: r.title ?? "",
                    due: dueDate(r).map { iso.string(from: $0) }
                )
            }
        return try ReminderEncoding.encodeRemindersJSON(dtos)
    }

    /// EKEventStore.fetchReminders(matching:completion:) is async/callback
    /// based (there is no synchronous fetch API); bridge to sync with a
    /// semaphore, same pattern as requestFullAccess above — a CLI run has no
    /// RunLoop spinning to deliver the completion otherwise.
    private static func fetchIncompleteReminders(store: EKEventStore) throws -> [EKReminder] {
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let sem = DispatchSemaphore(value: 0)
        var result: [EKReminder] = []
        store.fetchReminders(matching: predicate) { fetched in
            result = fetched ?? []
            sem.signal()
        }
        sem.wait()
        return result
    }

    private static func dueDate(_ r: EKReminder) -> Date? {
        guard let comps = r.dueDateComponents else { return nil }
        return Calendar.current.date(from: comps)
    }

    /// Creates one reminder on `defaultCalendarForNewReminders()`. Sets a due
    /// date (and a matching alarm, so it actually reminds — mirrors the old
    /// AppleScript path's `remind me date`) when `due` is given.
    static func createReminder(store: EKEventStore, name: String, due: Date?) throws -> String {
        let reminder = EKReminder(eventStore: store)
        reminder.title = name

        if let due {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: due
            )
            reminder.addAlarm(EKAlarm(absoluteDate: due))
        }

        guard let list = store.defaultCalendarForNewReminders() else {
            throw CLIError(message: "no default reminders list for new reminders")
        }
        reminder.calendar = list

        try store.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }
}
