import AppKit

/// Shared design system for a modern macOS look: large titles, grouped rounded
/// cards (System Settings style), left-aligned form rows, and accent buttons.
/// Colors come from dynamic system NSColors so light/dark both look right.
enum TerminalLaneUI {
    static let contentMargin: CGFloat = 32
    static let rowInset: CGFloat = 14

    // MARK: Typography

    static func largeTitle(_ text: String) -> NSTextField {
        let t = NSTextField(labelWithString: text)
        t.font = .systemFont(ofSize: 26, weight: .bold)
        t.textColor = .labelColor
        return t
    }

    static func subtitle(_ text: String) -> NSTextField {
        let t = NSTextField(wrappingLabelWithString: text)
        t.font = .systemFont(ofSize: 13)
        t.textColor = .secondaryLabelColor
        t.isSelectable = false
        return t
    }

    static func sectionCaption(_ text: String) -> NSTextField {
        let t = NSTextField(labelWithString: text.uppercased())
        t.font = .systemFont(ofSize: 11, weight: .semibold)
        t.textColor = .secondaryLabelColor
        return t
    }

    static func caption(_ text: String) -> NSTextField {
        let t = NSTextField(wrappingLabelWithString: text)
        t.font = .systemFont(ofSize: 11.5)
        t.textColor = .secondaryLabelColor
        t.isSelectable = false
        return t
    }

    // MARK: Fields

    static func field(placeholder: String = "") -> NSTextField {
        let f = NSTextField()
        f.placeholderString = placeholder
        f.font = .systemFont(ofSize: 13)
        f.controlSize = .large
        f.lineBreakMode = .byTruncatingTail
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return f
    }

    static func secureField(placeholder: String = "") -> NSSecureTextField {
        let f = NSSecureTextField()
        f.placeholderString = placeholder
        f.font = .systemFont(ofSize: 13)
        f.controlSize = .large
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return f
    }

    static func popUp() -> NSPopUpButton {
        let p = NSPopUpButton()
        p.controlSize = .large
        p.font = .systemFont(ofSize: 13)
        return p
    }

    // MARK: Buttons

    static func primaryButton(_ title: String, target: Any?, action: Selector) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .large
        b.keyEquivalent = "\r"           // default button → rendered in accent
        b.bezelColor = .controlAccentColor
        return b
    }

    static func secondaryButton(_ title: String, target: Any?, action: Selector) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .large
        return b
    }

    static func destructiveButton(_ title: String, target: Any?, action: Selector) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .large
        b.hasDestructiveAction = true
        b.contentTintColor = .systemRed
        return b
    }

    // MARK: Cards & rows

    /// A grouped, rounded card with hairline dividers between rows —
    /// the modern macOS "settings group" look.
    static func card(_ rows: [NSView]) -> NSView {
        let box = NSBox()
        box.boxType = .custom
        box.titlePosition = .noTitle
        box.fillColor = .controlBackgroundColor
        box.borderColor = .separatorColor
        box.borderWidth = 1
        box.cornerRadius = 10
        box.contentViewMargins = .zero
        box.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 0
        stack.alignment = .leading
        stack.distribution = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        for (i, row) in rows.enumerated() {
            if i > 0 { stack.addArrangedSubview(divider()) }
            stack.addArrangedSubview(row)
            row.leadingAnchor.constraint(equalTo: stack.leadingAnchor).isActive = true
            row.trailingAnchor.constraint(equalTo: stack.trailingAnchor).isActive = true
        }
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        ])
        box.contentView = content
        return box
    }

    /// A form row: label on the leading edge, control filling the trailing side.
    static func row(_ labelText: String, _ control: NSView, minHeight: CGFloat = 44) -> NSView {
        let row = NSView()
        row.translatesAutoresizingMaskIntoConstraints = false
        let label = NSTextField(labelWithString: labelText)
        label.font = .systemFont(ofSize: 13)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        label.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        control.translatesAutoresizingMaskIntoConstraints = false
        row.addSubview(label)
        row.addSubview(control)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: rowInset),
            label.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            label.widthAnchor.constraint(greaterThanOrEqualToConstant: 118),
            control.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 16),
            control.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -rowInset),
            control.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            control.topAnchor.constraint(greaterThanOrEqualTo: row.topAnchor, constant: 6),
            control.bottomAnchor.constraint(lessThanOrEqualTo: row.bottomAnchor, constant: -6),
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: minHeight),
        ])
        return row
    }

    /// A full-width informational row (no control) — e.g. read-only detail.
    static func infoRow(_ labelText: String, _ value: String) -> NSView {
        let value = NSTextField(labelWithString: value)
        value.font = .systemFont(ofSize: 13)
        value.textColor = .secondaryLabelColor
        value.lineBreakMode = .byTruncatingMiddle
        value.alignment = .right
        value.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return row(labelText, value)
    }

    static func divider() -> NSView {
        let line = NSBox()
        line.boxType = .custom
        line.fillColor = .separatorColor
        line.borderWidth = 0
        line.translatesAutoresizingMaskIntoConstraints = false
        line.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return line
    }

    /// A compact status pill (used for connection state).
    static func statusPill() -> NSTextField {
        let t = NSTextField(labelWithString: "")
        t.font = .systemFont(ofSize: 12, weight: .medium)
        t.textColor = .secondaryLabelColor
        t.lineBreakMode = .byTruncatingTail
        return t
    }
}
