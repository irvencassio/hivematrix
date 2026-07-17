import AppKit

/// Three panes, Canopy's layout: sites on the left, the browser in the middle,
/// the Command Log on the right. The log pane starts collapsed and is toggled
/// from the toolbar or a site's context menu.
final class RootSplitViewController: NSSplitViewController {
    private let sidebar = SidebarViewController()
    private let content = ContentViewController()
    private let history = HistoryPanelViewController()

    private var sidebarItem: NSSplitViewItem!
    private var historyItem: NSSplitViewItem!

    override func viewDidLoad() {
        super.viewDidLoad()

        sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebar)
        sidebarItem.minimumThickness = 200
        sidebarItem.maximumThickness = 300

        let contentItem = NSSplitViewItem(viewController: content)
        contentItem.minimumThickness = 420

        historyItem = NSSplitViewItem(viewController: history)
        historyItem.minimumThickness = 280
        historyItem.maximumThickness = 560
        historyItem.canCollapse = true
        historyItem.isCollapsed = true

        addSplitViewItem(sidebarItem)
        addSplitViewItem(contentItem)
        addSplitViewItem(historyItem)

        sidebar.onSelectSite = { [weak self] site in
            self?.open(site)
        }
        sidebar.onAddSite = { [weak self] in
            BrowserLaneEditTarget.shared.siteId = nil
            self?.content.show(.addSite)
        }
        sidebar.onViewLog = { [weak self] site in
            self?.history.show(site: site)
            self?.setHistory(collapsed: false)
        }
        // Any screen change re-tints the toolbar, including ones we did not
        // initiate (an SSO handoff jumping to the browser, Edit from a context menu).
        content.onScreenChanged = { [weak self] in self?.onPaneStateChanged?() }

        NotificationCenter.default.addObserver(
            self, selector: #selector(handleShowLog(_:)), name: .browserLaneShowLog, object: nil
        )
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func open(_ site: BrowserLaneSite) {
        // Keep the log pane pointed at whatever the sidebar is showing, so an open
        // panel never sits on a stale site after you switch.
        history.show(site: site)
        guard let url = URL(string: site.homeUrl), !site.homeUrl.isEmpty else {
            content.show(.browser)
            return
        }
        BrowserLaneNavigator.shared.openInBrowser(url)
    }

    @objc private func handleShowLog(_ note: Notification) {
        if let siteId = note.object as? String,
           let site = BrowserLaneSiteStore.shared.listSites().first(where: { $0.id == siteId }) {
            history.show(site: site)
        }
        setHistory(collapsed: false)
    }

    // MARK: - Toolbar actions

    /// Fired whenever a pane opens or closes so the toolbar can light its icon.
    /// The panes are also collapsible by dragging the split divider, so the
    /// toolbar must follow real state rather than track its own clicks.
    var onPaneStateChanged: (() -> Void)?

    // isViewLoaded-guarded: the toolbar is built during window setup and may ask
    // for pane state before viewDidLoad has created the split items.
    var isSidebarVisible: Bool { isViewLoaded && !sidebarItem.isCollapsed }
    var isHistoryVisible: Bool { isViewLoaded && !historyItem.isCollapsed }

    @objc func toggleSidebarPane() {
        sidebarItem.animator().isCollapsed.toggle()
        onPaneStateChanged?()
    }

    @objc func toggleHistoryPane() {
        setHistory(collapsed: !historyItem.isCollapsed)
    }

    private func setHistory(collapsed: Bool) {
        historyItem.animator().isCollapsed = collapsed
        onPaneStateChanged?()
    }

    /// A drag on the divider collapses a pane without going through our actions,
    /// which would leave the toolbar lit for a pane that is no longer showing.
    override func splitViewDidResizeSubviews(_ notification: Notification) {
        super.splitViewDidResizeSubviews(notification)
        onPaneStateChanged?()
    }

    /// Toolbar screens toggle. The sidebar is sites-only now, so there is no nav
    /// row to click back with — without this, opening Readiness or Settings is a
    /// dead end unless you happen to have a site to select.
    @objc func showReadiness() { toggleScreen(.readiness) }
    @objc func showSettings() { toggleScreen(.settings) }

    private func toggleScreen(_ screen: Screen) {
        content.show(content.currentScreen == screen ? .browser : screen)
    }

    var currentScreen: Screen { isViewLoaded ? content.currentScreen : .browser }
}
