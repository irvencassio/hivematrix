// Accessibility-tree read + act. AX-first is what lets a *local* model drive
// desktop automation acceptably: structured targets instead of pixel-guessing.

import Foundation
import ApplicationServices
import AppKit

enum AX {
    /// Find a running app's AXUIElement by bundle id or localized name.
    private static func appElement(for app: String) -> (AXUIElement, pid_t)? {
        let running = NSWorkspace.shared.runningApplications.first {
            $0.bundleIdentifier == app || $0.localizedName == app
        }
        guard let r = running else { return nil }
        return (AXUIElementCreateApplication(r.processIdentifier), r.processIdentifier)
    }

    private static func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
    }

    /// Serialize an element and its descendants to a bounded tree of
    /// {role, title, value, label, actions, children, path}. `maxDepth` and
    /// `maxNodes` keep the payload sane for a prompt.
    static func tree(for app: String, maxDepth: Int = 6, maxNodes: Int = 400) -> [String: Any]? {
        guard let (appEl, pid) = appElement(for: app) else { return nil }
        var count = 0
        func node(_ el: AXUIElement, depth: Int, path: String) -> [String: Any] {
            count += 1
            let role = (attr(el, kAXRoleAttribute as String) as? String) ?? "?"
            var dict: [String: Any] = ["role": role, "path": path]
            if let t = attr(el, kAXTitleAttribute as String) as? String, !t.isEmpty { dict["title"] = t }
            if let v = attr(el, kAXValueAttribute as String) as? String, !v.isEmpty { dict["value"] = v }
            if let d = attr(el, kAXDescriptionAttribute as String) as? String, !d.isEmpty { dict["label"] = d }
            // Available actions (press, etc.)
            var actionNames: CFArray?
            if AXUIElementCopyActionNames(el, &actionNames) == .success,
               let names = actionNames as? [String], !names.isEmpty {
                dict["actions"] = names
            }
            if depth < maxDepth, count < maxNodes,
               let children = attr(el, kAXChildrenAttribute as String) as? [AXUIElement], !children.isEmpty {
                var kids: [[String: Any]] = []
                for (i, child) in children.enumerated() {
                    if count >= maxNodes { break }
                    kids.append(node(child, depth: depth + 1, path: "\(path)/\(i)"))
                }
                if !kids.isEmpty { dict["children"] = kids }
            }
            return dict
        }
        let root = node(appEl, depth: 0, path: "")
        return ["app": app, "pid": pid, "truncated": count >= maxNodes, "tree": root]
    }

    /// Resolve a "/i/j/k" child path from the app root to a specific element.
    private static func resolve(_ app: String, path: String) -> AXUIElement? {
        guard let (appEl, _) = appElement(for: app) else { return nil }
        var el = appEl
        let parts = path.split(separator: "/").compactMap { Int($0) }
        for idx in parts {
            guard let children = attr(el, kAXChildrenAttribute as String) as? [AXUIElement],
                  idx >= 0, idx < children.count else { return nil }
            el = children[idx]
        }
        return el
    }

    /// Act on an element: press | setValue | <named AX action>.
    static func act(app: String, path: String, op: String, value: String?) -> Result<String, String> {
        guard let el = resolve(app, path: path) else { return .failure("element not found at path \(path)") }
        switch op {
        case "press":
            let r = AXUIElementPerformAction(el, kAXPressAction as CFString)
            return r == .success ? .success("pressed") : .failure("press failed (\(r.rawValue))")
        case "setValue":
            guard let v = value else { return .failure("setValue requires a value") }
            let r = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, v as CFString)
            return r == .success ? .success("value set") : .failure("setValue failed (\(r.rawValue))")
        default:
            // Treat op as a named AX action (e.g. AXShowMenu)
            let r = AXUIElementPerformAction(el, op as CFString)
            return r == .success ? .success("performed \(op)") : .failure("action \(op) failed (\(r.rawValue))")
        }
    }
}
