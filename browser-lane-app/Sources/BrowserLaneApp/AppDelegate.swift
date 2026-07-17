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
        // Without this, a code-built window has no key view loop and Tab does
        // nothing — every form field is an island. Nib-loaded windows get a loop
        // from the nib; we build our views in code, so AppKit has to derive the
        // order from geometry instead.
        window.autorecalculatesKeyViewLoop = true
        window.setFrameAutosaveName("BrowserLaneMain")
        installToolbar(on: window, split: splitVC)
        if UserDefaults.standard.string(forKey: "NSWindow Frame BrowserLaneMain") == nil {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        // The toolbar builds its items before the split view has loaded, so the
        // first tint pass reads "no panes visible" and leaves every icon gray.
        // Re-tint once the window is up and the panes actually exist.
        toolbarDelegate.refreshActiveStates()
        self.window = window
        BrowserLaneSettings.shared.applyIconState()
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Icon-only titlebar controls. Everything that used to be a sidebar nav row
    /// and isn't a site lives here: pane toggles, readiness, settings.
    private func installToolbar(on window: NSWindow, split: RootSplitViewController) {
        let toolbar = NSToolbar(identifier: "BrowserLaneToolbar")
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        toolbarDelegate.split = split
        toolbar.delegate = toolbarDelegate
        window.toolbar = toolbar
        window.toolbarStyle = .unified
    }

    private let toolbarDelegate = BrowserLaneToolbarDelegate()

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

/// Toolbar items, right-aligned via a flexible space. Held as a property on the
/// app delegate because NSWindow.toolbar does not retain its delegate.
///
/// Items use custom NSButton views rather than plain NSToolbarItems: an
/// NSToolbarItem has no on/off state, and Canopy's toolbar tints the icon of
/// whichever pane is currently showing. A button lets us re-tint on demand.
final class BrowserLaneToolbarDelegate: NSObject, NSToolbarDelegate {
    weak var split: RootSplitViewController? {
        didSet {
            split?.onPaneStateChanged = { [weak self] in self?.refreshActiveStates() }
            refreshActiveStates()
        }
    }

    /// Items whose tint tracks a pane, with the symbol needed to redraw them.
    private var paneItemRefs: [NSToolbarItem.Identifier: (item: NSToolbarItem, symbol: String)] = [:]

    /// Blue = this pane is showing, matching Canopy. Plain label color otherwise —
    /// not secondary, which would read as disabled next to a lit sibling.
    func refreshActiveStates() {
        guard let split else { return }
        setTint(ItemID.sidebar, active: split.isSidebarVisible)
        setTint(ItemID.log, active: split.isHistoryVisible)
        setTint(ItemID.readiness, active: split.currentScreen == .readiness)
        setTint(ItemID.settings, active: split.currentScreen == .settings)
    }

    private func setTint(_ id: NSToolbarItem.Identifier, active: Bool) {
        guard let entry = paneItemRefs[id] else { return }
        entry.item.image = Self.symbolImage(entry.symbol, active ? .controlAccentColor : .labelColor)
    }

    /// The color rides on the symbol rather than contentTintColor: the toolbar
    /// renders a button's template image in the system control color and ignores
    /// its tint, so a tinted-button approach stays gray no matter what. A palette
    /// image keeps the color we give it. Dynamic colors (labelColor) still resolve
    /// at draw time, so this follows light/dark without a manual redraw.
    private static func symbolImage(_ symbol: String, _ color: NSColor) -> NSImage? {
        let base = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        let config = NSImage.SymbolConfiguration(paletteColors: [color])
        return base?.withSymbolConfiguration(config)
    }

    private enum ItemID {
        static let sidebar = NSToolbarItem.Identifier("browserlane.sidebar")
        static let readiness = NSToolbarItem.Identifier("browserlane.readiness")
        static let log = NSToolbarItem.Identifier("browserlane.log")
        static let settings = NSToolbarItem.Identifier("browserlane.settings")
    }

    /// Which items reflect current state (and therefore get tinted): the two pane
    /// toggles plus the two screens the toolbar can switch to.
    private static let paneItems: Set<NSToolbarItem.Identifier> = [
        ItemID.sidebar, ItemID.log, ItemID.readiness, ItemID.settings,
    ]

    private static let ordered: [NSToolbarItem.Identifier] = [
        ItemID.sidebar, .flexibleSpace, ItemID.readiness, ItemID.log, ItemID.settings,
    ]

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { Self.ordered }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { Self.ordered }

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        switch itemIdentifier {
        case ItemID.sidebar:
            return item(itemIdentifier, "sidebar.left", "Sites", "Show or hide the sites sidebar", #selector(RootSplitViewController.toggleSidebarPane))
        case ItemID.readiness:
            return item(itemIdentifier, "checkmark.shield", "Readiness", "Authentication readiness for every site", #selector(RootSplitViewController.showReadiness))
        case ItemID.log:
            return item(itemIdentifier, "list.bullet.rectangle", "Command Log", "Show or hide the command log", #selector(RootSplitViewController.toggleHistoryPane))
        case ItemID.settings:
            return item(itemIdentifier, "gearshape", "Settings", "Browser Lane settings", #selector(RootSplitViewController.showSettings))
        default:
            return nil
        }
    }

    private func item(
        _ id: NSToolbarItem.Identifier,
        _ symbol: String,
        _ label: String,
        _ help: String,
        _ action: Selector
    ) -> NSToolbarItem {
        // A plain bordered item keeps the system's capsule styling; the palette
        // image carries the color through it.
        let item = NSToolbarItem(itemIdentifier: id)
        item.image = Self.symbolImage(symbol, .labelColor)
        item.label = label
        item.paletteLabel = label
        item.toolTip = help
        item.isBordered = true
        item.target = split
        item.action = action
        if Self.paneItems.contains(id) {
            paneItemRefs[id] = (item, symbol)
            refreshActiveStates()
        }
        return item
    }
}
