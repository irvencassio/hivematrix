import Foundation

public enum PromptLine {
    /// Extract the typed command from a shell input line by removing the prompt
    /// prefix. The prompt's delimiter is the EARLIEST marker on the line, so a
    /// marker the user types *after* the command (e.g. "rm x $ cat") cannot hide
    /// the real command — everything after the first delimiter is kept.
    public static func command(from line: String) -> String {
        let markers = ["❯ ", "$ ", "% ", "# ", "> "]
        var earliest: String.Index?
        for marker in markers {
            if let r = line.range(of: marker) {
                if earliest == nil || r.upperBound < earliest! { earliest = r.upperBound }
            }
        }
        if let earliest {
            return String(line[earliest...]).trimmingCharacters(in: .whitespaces)
        }
        return line.trimmingCharacters(in: .whitespaces)
    }
}
