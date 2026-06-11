// Synthesized keyboard + mouse via CGEvent. Coordinate input is the last-resort
// strategy (AX-first is preferred); always capture-verified by the caller.

import Foundation
import CoreGraphics

enum Input {
    /// Type a string by posting Unicode keyboard events.
    static func type(_ text: String) -> Result<String, String> {
        let src = CGEventSource(stateID: .combinedSessionState)
        for scalar in text.unicodeScalars {
            guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) else {
                return .failure("failed to create key event")
            }
            var ch = UniChar(scalar.value > 0xFFFF ? 0x20 : UInt16(scalar.value))
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &ch)
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &ch)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            usleep(4000)
        }
        return .success("typed \(text.count) chars")
    }

    /// Click at a screen coordinate (CGEvent). count=2 → double-click.
    static func click(x: Double, y: Double, count: Int = 1) -> Result<String, String> {
        let pt = CGPoint(x: x, y: y)
        let src = CGEventSource(stateID: .combinedSessionState)
        guard let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left),
              let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left) else {
            return .failure("failed to create mouse event")
        }
        for c in 1...max(1, count) {
            down.setIntegerValueField(.mouseEventClickState, value: Int64(c))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(c))
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            usleep(20000)
        }
        return .success("clicked at (\(Int(x)),\(Int(y)))")
    }
}
