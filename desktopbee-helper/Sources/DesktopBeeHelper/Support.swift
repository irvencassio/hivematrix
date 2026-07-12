// Internal helper conveniences.

import Foundation

// Let String be used as the failure type of Result for compact internal APIs.
// (Helper-internal only; not exposed across module boundaries.)
extension String: @retroactive Error {}

/// Parse an ISO-8601 timestamp, tolerating BOTH forms callers send:
/// `2026-07-12T18:05:00Z` (no fractional seconds) and
/// `2026-07-12T18:05:00.804Z` (JS `Date.toISOString()`). A bare
/// `ISO8601DateFormatter()` only accepts the former and rejects the latter,
/// which silently broke every timed reminder/calendar write. Try the default
/// first, then retry with fractional seconds enabled.
func parseISO8601Flexible(_ s: String) -> Date? {
    let plain = ISO8601DateFormatter()
    if let d = plain.date(from: s) { return d }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: s)
}
