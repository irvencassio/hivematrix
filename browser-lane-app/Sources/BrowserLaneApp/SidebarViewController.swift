import AppKit

final class SidebarViewController: NSViewController {
    var onSelect: ((Screen) -> Void)?
    private var tableView: NSTableView!

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 640))

        tableView = NSTableView()
        tableView.headerView = nil
        tableView.style = .sourceList
        tableView.rowHeight = 34
        tableView.delegate = self
        tableView.dataSource = self

        let col = NSTableColumn(identifier: .init("col"))
        col.isEditable = false
        tableView.addTableColumn(col)

        let scroll = NSScrollView(frame: view.bounds)
        scroll.documentView = tableView
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = false
        view.addSubview(scroll)

        DispatchQueue.main.async {
            self.tableView.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        }
    }
}

extension SidebarViewController: NSTableViewDataSource {
    func numberOfRows(in tableView: NSTableView) -> Int { Screen.allCases.count }
}

extension SidebarViewController: NSTableViewDelegate {
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let screen = Screen.allCases[row]

        let cell = SidebarCell()
        cell.configure(icon: screen.iconName, label: screen.title)
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = tableView.selectedRow
        guard row >= 0 else { return }
        onSelect?(Screen.allCases[row])
    }
}

private final class SidebarCell: NSView {
    private let icon = NSImageView()
    private let label = NSTextField(labelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        icon.imageScaling = .scaleProportionallyDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: 13)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(icon)
        addSubview(label)
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 16),
            icon.heightAnchor.constraint(equalToConstant: 16),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func configure(icon iconName: String, label text: String) {
        icon.image = NSImage(systemSymbolName: iconName, accessibilityDescription: nil)
        label.stringValue = text
    }
}
