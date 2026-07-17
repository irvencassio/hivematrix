import Foundation

/// One step of a site's login recipe.
///
/// Deliberately a fixed, tiny vocabulary rather than a script: a recipe runs in a
/// context that holds the operator's sign-in, and arbitrary JS there could read
/// the value and post it anywhere. These four verbs cannot express exfiltration.
enum BrowserLaneLoginStep: Equatable {
    /// Click the first element matching the selector.
    case click(selector: String)
    /// Click the first visible, enabled element matching the selector whose text
    /// contains the given string. Real sign-in pages (React/Tailwind SPAs) often
    /// give their buttons no id, name, or type — only their label is stable. CSS
    /// cannot match on text, so without this verb those pages are undriveable.
    /// Polls, because such buttons are usually disabled until a field is filled.
    case clickText(selector: String, text: String, timeout: TimeInterval)
    /// Wait until the selector exists (and is visible) or time out.
    case waitFor(selector: String, timeout: TimeInterval)
    /// Pause for a fixed number of seconds.
    ///
    /// The escape hatch for single-page sign-ins that reuse the same selector
    /// across screens: after "Next", step 2's field is another
    /// `input[type="text"]`, so `waitFor` matches instantly — possibly against the
    /// screen you just left — and there is nothing new to wait *for*. A short
    /// pause lets the screen swap before the next fill.
    case wait(seconds: TimeInterval)
    /// Type a value into a field. The value is a placeholder or a literal.
    case fill(selector: String, value: BrowserLaneLoginValue)
    /// Submit the form containing the selector (or press Enter in it if the page
    /// has no form element — increasingly common in SPA logins).
    case submit(selector: String)

    var selector: String {
        switch self {
        case .click(let s), .waitFor(let s, _), .submit(let s): return s
        case .clickText(let s, let t, _): return "\(s) “\(t)”"
        case .fill(let s, _): return s
        case .wait(let seconds): return "\(Int(seconds))s pause"
        }
    }

    /// Steps that put a stored sign-in on the page. These are the only ones that
    /// require an origin check before they run.
    var carriesCredential: Bool {
        if case .fill(_, let value) = self { return value.isSecret }
        return false
    }
}

/// What a `fill` step types. Placeholders are resolved natively at run time, so a
/// recipe never contains a real sign-in and is safe to store, print, and edit.
enum BrowserLaneLoginValue: Equatable {
    case username
    case secret
    case literal(String)

    var isSecret: Bool { self == .secret || self == .username }

    var token: String {
        switch self {
        case .username: return "$username"
        case .secret: return "$password"
        case .literal(let text): return text
        }
    }
}

enum BrowserLaneRecipeError: LocalizedError, Equatable {
    case unknownVerb(String, line: Int)
    case missingSelector(String, line: Int)
    case missingValue(line: Int)
    case badTimeout(String, line: Int)

    var errorDescription: String? {
        switch self {
        case .unknownVerb(let verb, let line):
            return "Line \(line): unknown step “\(verb)”. Use click, clickText, waitFor, wait, fill, or submit."
        case .missingSelector(let verb, let line):
            return "Line \(line): “\(verb)” needs a CSS selector."
        case .missingValue(let line):
            return "Line \(line): “fill” needs a value — $username, $password, or literal text."
        case .badTimeout(let raw, let line):
            return "Line \(line): “\(raw)” is not a valid timeout in seconds."
        }
    }
}

/// A site's login recipe: an ordered step list parsed from a small line-based text
/// format, so it can be hand-edited in the site form and read at a glance.
///
///     click   a[href*="signin"]
///     waitFor #username
///     fill    #username $username
///     click   #next
///     waitFor #password 20
///     fill    #password $password
///     submit  #password
struct BrowserLaneLoginRecipe: Equatable {
    let steps: [BrowserLaneLoginStep]

    var isEmpty: Bool { steps.isEmpty }

    static let defaultTimeout: TimeInterval = 15

    static func parse(_ source: String) throws -> BrowserLaneLoginRecipe {
        var steps: [BrowserLaneLoginStep] = []
        for (index, rawLine) in source.components(separatedBy: .newlines).enumerated() {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            let lineNumber = index + 1

            let verb = String(line.prefix(while: { !$0.isWhitespace }))
            let rest = line.dropFirst(verb.count).trimmingCharacters(in: .whitespaces)

            switch verb.lowercased() {
            case "click", "submit":
                guard !rest.isEmpty else { throw BrowserLaneRecipeError.missingSelector(verb, line: lineNumber) }
                steps.append(verb.lowercased() == "click" ? .click(selector: rest) : .submit(selector: rest))

            case "waitfor":
                guard !rest.isEmpty else { throw BrowserLaneRecipeError.missingSelector(verb, line: lineNumber) }
                // Trailing number = timeout override. Selectors can contain spaces,
                // so split from the right and only treat it as a timeout if numeric.
                let parts = rest.split(separator: " ")
                if parts.count > 1, let last = parts.last, let seconds = TimeInterval(last) {
                    guard seconds > 0, seconds <= 120 else {
                        throw BrowserLaneRecipeError.badTimeout(String(last), line: lineNumber)
                    }
                    let selector = parts.dropLast().joined(separator: " ")
                    steps.append(.waitFor(selector: selector, timeout: seconds))
                } else {
                    steps.append(.waitFor(selector: rest, timeout: defaultTimeout))
                }

            case "wait":
                guard let seconds = TimeInterval(rest), seconds > 0, seconds <= 120 else {
                    throw BrowserLaneRecipeError.badTimeout(rest, line: lineNumber)
                }
                steps.append(.wait(seconds: seconds))

            case "clicktext":
                // "clickText button Next" / "clickText button Sign In" — first token
                // is the selector, the remainder is the label to match.
                let parts = rest.split(separator: " ", maxSplits: 1)
                guard parts.count == 2, !parts[1].isEmpty else {
                    throw parts.count < 2
                        ? BrowserLaneRecipeError.missingValue(line: lineNumber)
                        : BrowserLaneRecipeError.missingSelector(verb, line: lineNumber)
                }
                steps.append(.clickText(
                    selector: String(parts[0]),
                    text: String(parts[1]),
                    timeout: defaultTimeout
                ))

            case "fill":
                // Value is the last whitespace-run token; selectors may contain spaces.
                let parts = rest.split(separator: " ")
                guard parts.count >= 2 else {
                    throw parts.isEmpty
                        ? BrowserLaneRecipeError.missingSelector(verb, line: lineNumber)
                        : BrowserLaneRecipeError.missingValue(line: lineNumber)
                }
                let selector = parts.dropLast().joined(separator: " ")
                let value: BrowserLaneLoginValue = switch String(parts.last!) {
                case "$username": .username
                case "$password": .secret
                default: .literal(String(parts.last!))
                }
                steps.append(.fill(selector: selector, value: value))

            default:
                throw BrowserLaneRecipeError.unknownVerb(verb, line: lineNumber)
            }
        }
        return BrowserLaneLoginRecipe(steps: steps)
    }

    /// Round-trips back to the editable text form.
    func serialized() -> String {
        steps.map { step in
            switch step {
            case .click(let s): return "click   \(s)"
            case .clickText(let s, let t, _): return "clickText \(s) \(t)"
            case .submit(let s): return "submit  \(s)"
            case .waitFor(let s, let t):
                return t == Self.defaultTimeout ? "waitFor \(s)" : "waitFor \(s) \(Int(t))"
            case .fill(let s, let v): return "fill    \(s) \(v.token)"
            case .wait(let seconds): return "wait    \(Int(seconds))"
            }
        }.joined(separator: "\n")
    }
}
