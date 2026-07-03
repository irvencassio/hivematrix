import AppKit

final class TerminalLaneAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var runServer: LaneHTTPServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        installMainMenu()
        startRunServer()
        let splitVC = RootSplitViewController()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Terminal Lane"
        window.contentViewController = splitVC
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Bind 4012 so the agent's `terminal_run` / session tools POST straight to
    /// this visible app (default `http://127.0.0.1:4012`). Daemon override is
    /// TERMINAL_LANE_BASE_URL.
    private func startRunServer() {
        let server = LaneHTTPServer(port: 4012) { req, respond in
            guard req.method == "POST" else {
                respond(404, Data(#"{"error":"not_found"}"#.utf8))
                return
            }
            let body = (try? JSONSerialization.jsonObject(with: req.body) as? [String: Any]) ?? [:]
            switch req.path {
            case let p where p.hasPrefix("/run"):
                let sessionId = (body["sessionId"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
                let command = body["command"] as? String ?? ""
                let timeoutMs = body["timeoutMs"] as? Int
                guard !sessionId.isEmpty, !command.isEmpty else {
                    respond(400, Data(#"{"error":"sessionId and command are required"}"#.utf8))
                    return
                }
                TerminalRunService.shared.run(sessionId: sessionId, command: command, timeoutMs: timeoutMs) { outcome in
                    let payload: [String: Any] = [
                        "output": outcome.output,
                        "exitCode": outcome.exitCode as Any? ?? NSNull(),
                        "timedOut": outcome.timedOut,
                    ]
                    respond(200, (try? JSONSerialization.data(withJSONObject: payload)) ?? Data())
                }
            case let p where p.hasPrefix("/session"):
                let action = body["action"] as? String ?? ""
                switch action {
                case "create":
                    let id = TerminalRunService.shared.createSession(id: body["sessionId"] as? String, cwd: body["cwd"] as? String)
                    respond(200, (try? JSONSerialization.data(withJSONObject: ["id": id])) ?? Data())
                case "list":
                    let sessions = TerminalRunService.shared.listSessions().map {
                        ["id": $0.id, "cwd": $0.cwd, "alive": $0.alive, "createdAt": $0.createdAt] as [String: Any]
                    }
                    respond(200, (try? JSONSerialization.data(withJSONObject: ["sessions": sessions])) ?? Data())
                case "kill":
                    let killed = TerminalRunService.shared.killSession(id: body["sessionId"] as? String ?? "")
                    respond(200, (try? JSONSerialization.data(withJSONObject: ["killed": killed])) ?? Data())
                default:
                    respond(400, Data(#"{"error":"action must be create | list | kill"}"#.utf8))
                }
            default:
                respond(404, Data(#"{"error":"not_found"}"#.utf8))
            }
        }
        server.start()
        self.runServer = server
    }

    // Without a main menu, AppKit never routes Cmd-C/V/X/A to the first responder,
    // so clipboard shortcuts silently die in every text field. Install the
    // standard App + Edit menus to restore them.
    private func installMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Terminal Lane", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")

        NSApplication.shared.mainMenu = mainMenu
    }
}
