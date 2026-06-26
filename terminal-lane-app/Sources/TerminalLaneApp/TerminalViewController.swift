import AppKit
import SwiftTerm

final class TerminalViewController: NSViewController {
    private let profilePopup = NSPopUpButton()
    private var profiles: [TerminalLaneProfile] = []
    private var terminalView: LocalProcessTerminalView?

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Terminal")
        title.font = .systemFont(ofSize: 34, weight: .bold)

        profilePopup.target = self
        profilePopup.action = #selector(openSelectedProfile)
        let openButton = NSButton(title: "Open Session", target: self, action: #selector(openSelectedProfile))

        let top = NSStackView(views: [profilePopup, openButton])
        top.orientation = .horizontal
        top.spacing = 8
        let terminal = makeTerminalView()
        terminalView = terminal

        let stack = NSStackView(views: [title, top, terminal])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -28),
            terminal.heightAnchor.constraint(greaterThanOrEqualToConstant: 480),
        ])
        reloadProfiles()
    }

    private func reloadProfiles() {
        profiles = TerminalLaneProfileStore.shared.load()
        profilePopup.removeAllItems()
        profilePopup.addItems(withTitles: profiles.map(\.displayName))
    }

    @objc private func openSelectedProfile() {
        guard profilePopup.indexOfSelectedItem >= 0, profilePopup.indexOfSelectedItem < profiles.count else { return }
        let profile = profiles[profilePopup.indexOfSelectedItem]
        terminalView?.terminate()
        let cwd = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        terminalView?.startProcess(
            executable: "/bin/bash",
            args: ["-lc", "exec \(profile.openCommand)"],
            environment: nil,
            execName: "TerminalLane",
            currentDirectory: cwd
        )
        view.window?.title = "Terminal Lane — \(profile.displayName)"
    }

    private func makeTerminalView() -> LocalProcessTerminalView {
        let terminal = LocalProcessTerminalView(frame: .zero)
        terminal.translatesAutoresizingMaskIntoConstraints = false
        terminal.wantsLayer = true
        terminal.layer?.backgroundColor = NSColor.black.cgColor
        return terminal
    }
}
