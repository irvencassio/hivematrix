import AppKit

final class RootSplitViewController: NSSplitViewController {
    private let sidebar = SidebarViewController()
    private let content = ContentViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        let sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebar)
        sidebarItem.minimumThickness = 190
        sidebarItem.maximumThickness = 230
        let contentItem = NSSplitViewItem(viewController: content)
        contentItem.minimumThickness = 620
        addSplitViewItem(sidebarItem)
        addSplitViewItem(contentItem)
        sidebar.onSelect = { [weak self] screen in self?.content.show(screen) }
    }
}
