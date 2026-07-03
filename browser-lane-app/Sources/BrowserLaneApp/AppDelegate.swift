import AppKit

final class BrowserLaneAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var readServer: LaneHTTPServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        installMainMenu()
        startReadServer()

        let splitVC = RootSplitViewController()

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Browser Lane"
        window.contentViewController = splitVC
        window.setFrameAutosaveName("BrowserLaneMain")
        if UserDefaults.standard.string(forKey: "NSWindow Frame BrowserLaneMain") == nil {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        self.window = window
        BrowserLaneSettings.shared.applyIconState()
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Bind 4011 so the agent's `hivematrix_browser` tool POSTs straight to this
    /// visible app (default `http://127.0.0.1:4011/answer`). The daemon override
    /// is BROWSER_LANE_READ_BASE_URL; the port is fixed here to match the default.
    private func startReadServer() {
        let server = LaneHTTPServer(port: 4011) { req, respond in
            guard req.method == "POST", req.path.hasPrefix("/answer") else {
                respond(404, Data(#"{"status":"failed","errorCode":"not_found"}"#.utf8))
                return
            }
            let query = Self.extractQuery(from: req.body)
            guard !query.isEmpty else {
                respond(400, BrowserReadResult.failed("missing_query").jsonData())
                return
            }
            BrowserReadService.shared.answer(query: query) { result in
                respond(200, result.jsonData())
            }
        }
        server.start()
        self.readServer = server
    }

    private static func extractQuery(from body: Data) -> String {
        guard
            let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let query = obj["query"] as? String
        else { return "" }
        return query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Without a main menu, AppKit never routes Cmd-C/V/X/A to the first responder,
    // so clipboard shortcuts silently die in every text field. Install the
    // standard App + Edit menus to restore them.
    private func installMainMenu() {
        let mainMenu = NSMenu()

        // App menu (Quit).
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Browser Lane", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // Edit menu — first-responder selectors for clipboard + selection.
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
