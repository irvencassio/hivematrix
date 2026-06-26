import AppKit
import SwiftTerm

final class TerminalViewController: NSViewController {
    private let profilePopup = NSPopUpButton()
    private var profiles: [TerminalLaneProfile] = []
    private var terminalView: LocalProcessTerminalView?
    private let modeLabel = NSTextField(labelWithString: "")

    override func loadView() {
        view = NSView()
        let title = NSTextField(labelWithString: "Terminal")
        title.font = .systemFont(ofSize: 34, weight: .bold)

        profilePopup.target = self
        profilePopup.action = #selector(profileSelectionChanged)
        let openButton = NSButton(title: "Open Session", target: self, action: #selector(openSelectedProfile))

        let top = NSStackView(views: [profilePopup, openButton])
        top.orientation = .horizontal
        top.spacing = 8
        modeLabel.font = .systemFont(ofSize: 12)
        modeLabel.lineBreakMode = .byWordWrapping
        modeLabel.maximumNumberOfLines = 2
        let terminal = makeTerminalView()
        terminalView = terminal

        let stack = NSStackView(views: [title, top, modeLabel, terminal])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -28),
            terminal.heightAnchor.constraint(greaterThanOrEqualToConstant: 460),
        ])
        reloadProfiles()
    }

    private func reloadProfiles() {
        profiles = TerminalLaneProfileStore.shared.load()
        profilePopup.removeAllItems()
        profilePopup.addItems(withTitles: profiles.map(\.displayName))
        profileSelectionChanged()
    }

    private func currentProfile() -> TerminalLaneProfile? {
        let i = profilePopup.indexOfSelectedItem
        guard i >= 0, i < profiles.count else { return nil }
        return profiles[i]
    }

    // Show connect mode and whether auto-connect is supported, honestly.
    @objc private func profileSelectionChanged() {
        guard let profile = currentProfile() else { modeLabel.stringValue = ""; return }
        let mode = profile.authMethod.label
        if profile.autoConnect {
            modeLabel.textColor = .secondaryLabelColor
            modeLabel.stringValue = "Mode: \(mode) · auto-connect supported."
        } else {
            modeLabel.textColor = .systemOrange
            modeLabel.stringValue = "Mode: \(mode) · " + (profile.authMethod.connectReason ?? "auto-connect not supported.")
        }
    }

    @objc private func openSelectedProfile() {
        guard let profile = currentProfile() else { return }
        // For password_keychain we do NOT silently spawn ssh pretending to use a
        // stored secret. Surface the honest reason instead.
        if profile.authMethod == .password_keychain {
            modeLabel.textColor = .systemOrange
            modeLabel.stringValue = profile.authMethod.connectReason ?? "Not auto-connectable yet."
            return
        }
        terminalView?.terminate()
        let cwd = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        // openCommand never contains a secret; manual_password simply prompts in the PTY.
        terminalView?.startProcess(
            executable: "/bin/bash",
            args: ["-lc", "exec \(profile.openCommand)"],
            environment: nil,
            execName: "TerminalLane",
            currentDirectory: cwd
        )
        view.window?.title = "Terminal Lane — \(profile.displayName)"
        if !profile.autoConnect {
            modeLabel.textColor = .systemOrange
            modeLabel.stringValue = profile.authMethod.connectReason ?? "You'll be prompted to authenticate."
        }
    }

    private func makeTerminalView() -> LocalProcessTerminalView {
        let terminal = LocalProcessTerminalView(frame: .zero)
        terminal.translatesAutoresizingMaskIntoConstraints = false
        terminal.wantsLayer = true
        terminal.layer?.backgroundColor = NSColor.black.cgColor
        return terminal
    }
}
