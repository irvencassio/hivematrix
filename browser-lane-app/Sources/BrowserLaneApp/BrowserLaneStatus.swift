import AppKit

/// A scroll view's clip view is not flipped, so a document view shorter than the
/// scroll view lays out from the bottom up — which parked the whole Readiness
/// screen at the bottom of a tall window. Use this as the document view of any
/// hand-built (non-NSTableView) scrolling content so it lays out from the top.
final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// Single source of truth for readiness status presentation, shared by the
/// sidebar and the readiness screen. The daemon owns the status→color mapping
/// (`normalizeBrowserReadinessState`); this only renders what it reports.
enum BrowserLaneStatus {
    /// Daemon colors: green | yellow | orange | red | gray.
    static func color(for daemonColor: String) -> NSColor {
        switch daemonColor {
        case "green":  return .systemGreen
        case "yellow": return .systemYellow
        case "orange": return .systemOrange
        case "red":    return .systemRed
        default:       return .systemGray
        }
    }

    /// A session counts as established only when the last probe said `ready` AND
    /// that probe is still fresh. A stale green is not a live session — the dot
    /// goes hollow rather than claiming a sign-in we cannot vouch for.
    static func sessionEstablished(color: String, stale: Bool) -> Bool {
        color == "green" && !stale
    }
}

/// Canopy's connection dot: a small filled circle pinned to the icon's
/// bottom-trailing corner. Hollow (ring only) when the signal is stale, so
/// "checked and ready" and "probably ready, unverified" never look identical.
final class StatusDotView: NSView {
    private var fillColor: NSColor = .systemGray
    private var filled = true

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 8, height: 8))
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 8),
            heightAnchor.constraint(equalToConstant: 8),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func apply(daemonColor: String, stale: Bool) {
        fillColor = BrowserLaneStatus.color(for: daemonColor)
        filled = !stale
        toolTip = stale ? "Last check is stale — status unverified" : nil
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let inset = bounds.insetBy(dx: 1, dy: 1)
        let path = NSBezierPath(ovalIn: inset)
        // A ring reads as "unconfirmed" at a glance; a disc reads as "live".
        if filled {
            fillColor.setFill()
            path.fill()
        } else {
            fillColor.setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
    }
}
