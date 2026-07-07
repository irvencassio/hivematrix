import AppKit

/// Modern source-list sidebar: translucent background, SF Symbol + label rows,
/// and a rounded accent selection that adapts to theme and accent color.
final class SidebarViewController: NSViewController {
    var onSelect: ((TerminalLaneScreen) -> Void)?
    private var rows: [TerminalLaneScreen: SidebarRow] = [:]
    private var selected: TerminalLaneScreen = .terminal

    override func loadView() {
        let effect = NSVisualEffectView()
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.state = .followsWindowActiveState
        view = effect

        let header = NSTextField(labelWithString: "Terminal Lane")
        header.font = .systemFont(ofSize: 15, weight: .bold)
        header.textColor = .labelColor

        let list = NSStackView()
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 2
        list.translatesAutoresizingMaskIntoConstraints = false

        for screen in TerminalLaneScreen.allCases {
            let row = SidebarRow(screen: screen) { [weak self] in self?.select(screen) }
            rows[screen] = row
            list.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: list.widthAnchor).isActive = true
        }

        let stack = NSStackView(views: [header, list])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 22),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            header.leadingAnchor.constraint(equalTo: stack.leadingAnchor, constant: 8),
        ])
        updateSelection()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        onSelect?(.terminal)
    }

    private func select(_ screen: TerminalLaneScreen) {
        selected = screen
        updateSelection()
        onSelect?(screen)
    }

    private func updateSelection() {
        for (screen, row) in rows { row.setSelected(screen == selected) }
    }
}

/// One clickable sidebar item with a symbol, a label, and a rounded selection.
final class SidebarRow: NSView {
    private let onClick: () -> Void
    private let iconView = NSImageView()
    private let labelView = NSTextField(labelWithString: "")
    private let selectionView = NSVisualEffectView()

    init(screen: TerminalLaneScreen, onClick: @escaping () -> Void) {
        self.onClick = onClick
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true

        selectionView.material = .selection
        selectionView.isEmphasized = true
        selectionView.state = .active
        selectionView.isHidden = true
        selectionView.wantsLayer = true
        selectionView.layer?.cornerRadius = 6
        selectionView.layer?.cornerCurve = .continuous
        selectionView.translatesAutoresizingMaskIntoConstraints = false

        let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        iconView.image = NSImage(systemSymbolName: screen.symbolName, accessibilityDescription: screen.title)?
            .withSymbolConfiguration(config)
        iconView.contentTintColor = .secondaryLabelColor
        iconView.translatesAutoresizingMaskIntoConstraints = false

        labelView.stringValue = screen.title
        labelView.font = .systemFont(ofSize: 13, weight: .medium)
        labelView.textColor = .labelColor
        labelView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(selectionView)
        addSubview(iconView)
        addSubview(labelView)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 30),
            selectionView.topAnchor.constraint(equalTo: topAnchor),
            selectionView.bottomAnchor.constraint(equalTo: bottomAnchor),
            selectionView.leadingAnchor.constraint(equalTo: leadingAnchor),
            selectionView.trailingAnchor.constraint(equalTo: trailingAnchor),
            iconView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            iconView.centerYAnchor.constraint(equalTo: centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 20),
            labelView.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 8),
            labelView.centerYAnchor.constraint(equalTo: centerYAnchor),
            labelView.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
        ])

        let click = NSClickGestureRecognizer(target: self, action: #selector(handleClick))
        addGestureRecognizer(click)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func handleClick() { onClick() }

    func setSelected(_ isSelected: Bool) {
        selectionView.isHidden = !isSelected
        labelView.textColor = isSelected ? .white : .labelColor
        iconView.contentTintColor = isSelected ? .white : .secondaryLabelColor
    }
}
