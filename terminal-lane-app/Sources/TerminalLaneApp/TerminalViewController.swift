import AppKit
import Citadel
import NIOCore
import SwiftTerm
import TerminalLaneCore

final class TerminalViewController: NSViewController {
    private let profilePopup = TerminalLaneUI.popUp()
    private var profiles: [TerminalLaneProfile] = []
    private let modeLabel = TerminalLaneUI.caption("")
    private let statusPill = TerminalLaneUI.statusPill()
    private let terminalContainer = NSView()

    // Local + system-ssh (agent/key-file/manual) run in a local PTY.
    private var localTerminalView: PolicedLocalProcessTerminalView?
    // password_keychain runs over the native SSH runtime, bridged into a plain
    // SwiftTerm view.
    private var sshTerminalView: TerminalView?
    private var sshCoordinator: SSHTerminalCoordinator?
    private var sshService: TerminalLaneSSHService?
    private var stdinWriter: TTYStdinWriter?
    private var activeProfile: TerminalLaneProfile?

    override func loadView() {
        view = NSView()
        let title = TerminalLaneUI.largeTitle("Terminal")

        profilePopup.target = self
        profilePopup.action = #selector(profileSelectionChanged)
        let openButton = TerminalLaneUI.primaryButton("Open Session", target: self, action: #selector(openSelectedProfile))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let controls = NSStackView(views: [profilePopup, openButton, spacer, statusPill])
        controls.orientation = .horizontal
        controls.spacing = 10
        controls.translatesAutoresizingMaskIntoConstraints = false

        terminalContainer.wantsLayer = true
        terminalContainer.layer?.backgroundColor = NSColor.black.cgColor
        terminalContainer.layer?.cornerRadius = 8
        terminalContainer.layer?.cornerCurve = .continuous
        terminalContainer.layer?.masksToBounds = true
        terminalContainer.layer?.borderWidth = 1
        terminalContainer.layer?.borderColor = NSColor.separatorColor.cgColor
        terminalContainer.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [title, controls, modeLabel, terminalContainer])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: TerminalLaneUI.contentMargin),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: TerminalLaneUI.contentMargin),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -TerminalLaneUI.contentMargin),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -TerminalLaneUI.contentMargin),
            controls.widthAnchor.constraint(equalTo: stack.widthAnchor),
            modeLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            terminalContainer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            terminalContainer.heightAnchor.constraint(greaterThanOrEqualToConstant: 440),
        ])
        reloadProfiles()

        // Show agent runs (POST /run) live in this terminal view.
        TerminalRunService.shared.display = self
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
            let extra = profile.authMethod.usesNativeSSH ? " · auto-connects natively with the Keychain password." : " · auto-connect supported."
            modeLabel.textColor = .secondaryLabelColor
            modeLabel.stringValue = "Mode: \(mode)\(extra)"
        } else {
            modeLabel.textColor = .systemOrange
            modeLabel.stringValue = "Mode: \(mode) · " + (profile.authMethod.connectReason ?? "you'll be prompted to authenticate.")
        }
    }

    // MARK: Terminal view swapping

    private func installTerminal(_ terminal: NSView) {
        terminalContainer.subviews.forEach { $0.removeFromSuperview() }
        terminal.translatesAutoresizingMaskIntoConstraints = false
        terminalContainer.addSubview(terminal)
        NSLayoutConstraint.activate([
            terminal.topAnchor.constraint(equalTo: terminalContainer.topAnchor),
            terminal.bottomAnchor.constraint(equalTo: terminalContainer.bottomAnchor),
            terminal.leadingAnchor.constraint(equalTo: terminalContainer.leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: terminalContainer.trailingAnchor),
        ])
    }

    private func makeLocalTerminalView() -> PolicedLocalProcessTerminalView {
        let terminal = PolicedLocalProcessTerminalView(frame: .zero)
        terminal.wantsLayer = true
        terminal.layer?.backgroundColor = NSColor.black.cgColor
        terminal.gate = { [weak self] data, term in
            guard let self else { return true }
            if !data.contains(0x0D) { return true }
            let pending = Self.pendingLine(of: term.getTerminal())
            return self.gateOnEnter(pendingLine: pending, terminal: term)
        }
        return terminal
    }

    @objc private func openSelectedProfile() {
        guard let profile = currentProfile() else { return }
        activeProfile = profile
        view.window?.title = "Terminal Lane — \(profile.displayName)"

        if profile.authMethod.usesNativeSSH {
            openNativeSSH(profile)
            return
        }

        // Tear down any native SSH session before switching to a local PTY.
        teardownNativeSSH()
        let local = localTerminalView ?? makeLocalTerminalView()
        localTerminalView = local
        installTerminal(local)
        local.terminate()
        let cwd = profile.cwd ?? FileManager.default.homeDirectoryForCurrentUser.path
        // openCommand never contains a secret; manual_password simply prompts in the PTY.
        local.startProcess(
            executable: "/bin/bash",
            args: ["-lc", "exec \(profile.openCommand)"],
            environment: nil,
            execName: "TerminalLane",
            currentDirectory: cwd
        )
        view.window?.makeFirstResponder(local)
        if profile.autoConnect {
            statusPill.textColor = .systemGreen
            statusPill.stringValue = "● Connected"
        } else {
            statusPill.textColor = .systemOrange
            statusPill.stringValue = "● Authenticate in the session"
        }
    }

    // MARK: Native SSH (password_keychain)

    private func openNativeSSH(_ profile: TerminalLaneProfile) {
        guard let key = profile.keychainKey else { return }
        guard let password = TerminalLaneKeychain.shared.readPassword(host: key.host, user: key.user, port: key.port) else {
            statusPill.textColor = .systemOrange
            statusPill.stringValue = "● No Keychain password — edit the profile"
            return
        }

        teardownNativeSSH()
        let terminal = TerminalView(frame: .zero)
        terminal.wantsLayer = true
        terminal.layer?.backgroundColor = NSColor.black.cgColor
        let coordinator = SSHTerminalCoordinator(controller: self)
        terminal.terminalDelegate = coordinator
        sshTerminalView = terminal
        sshCoordinator = coordinator
        installTerminal(terminal)

        statusPill.textColor = .secondaryLabelColor
        statusPill.stringValue = "● Connecting…"

        let cols = terminal.getTerminal().cols
        let rows = terminal.getTerminal().rows
        let service = TerminalLaneSSHService()
        sshService = service

        Task { @MainActor in
            do {
                try await service.connect(host: key.host, port: key.port, user: key.user, password: password)
                let writer = try await service.openPTY(
                    cols: cols, rows: rows,
                    onOutput: { [weak self] data in
                        Task { @MainActor in self?.feedSSH(data) }
                    },
                    onClose: { [weak self] in
                        Task { @MainActor in self?.sshDidClose() }
                    }
                )
                self.stdinWriter = writer
                self.view.window?.makeFirstResponder(terminal)
                self.statusPill.textColor = .systemGreen
                self.statusPill.stringValue = "● Connected"
            } catch {
                self.statusPill.textColor = .systemRed
                self.statusPill.stringValue = "● \(error.localizedDescription)"
            }
        }
    }

    private func feedSSH(_ data: Data) {
        sshTerminalView?.feed(byteArray: ArraySlice([UInt8](data)))
    }

    private func sshDidClose() {
        statusPill.textColor = .secondaryLabelColor
        statusPill.stringValue = "● Disconnected"
        stdinWriter = nil
    }

    fileprivate func sendSSHInput(_ data: ArraySlice<UInt8>) {
        guard let writer = stdinWriter, let terminal = sshTerminalView else { return }
        if data.contains(0x0D) {
            let pending = Self.pendingLine(of: terminal.getTerminal())
            if !gateOnEnter(pendingLine: pending, terminal: terminal) {
                let clear = ByteBuffer(bytes: [0x15]) // Ctrl-U clears the remote input line
                Task { try? await writer.write(clear) }
                return
            }
        }
        let buffer = ByteBuffer(bytes: Array(data))
        Task { try? await writer.write(buffer) }
    }

    fileprivate func resizeSSH(cols: Int, rows: Int) {
        guard let writer = stdinWriter else { return }
        Task { try? await writer.changeSize(cols: cols, rows: rows, pixelWidth: 0, pixelHeight: 0) }
    }

    private func teardownNativeSSH() {
        if let service = sshService { Task { await service.disconnect() } }
        sshService = nil
        stdinWriter = nil
        sshCoordinator = nil
        sshTerminalView = nil
    }

    private var activeTerminalView: TerminalView? { sshTerminalView ?? localTerminalView }

    // MARK: Command policy gate

    /// Returns true if the Enter should be forwarded (command allowed), false if
    /// it was blocked (caller must clear the line and not forward).
    private func gateOnEnter(pendingLine: String, terminal: TerminalView) -> Bool {
        guard let profile = activeProfile else { return true }
        let command = Self.stripPrompt(pendingLine)
        if command.isEmpty { return true }
        let decision = TerminalLanePolicy.shared.policy.decide(commandLine: command, mode: profile.coreAccessMode)
        let ip = profile.host ?? "local"
        switch decision {
        case .allow:
            logCommand(profile: profile, ip: ip, decision: "RAN", command: command)
            return true
        case .blocked(let reason):
            logCommand(profile: profile, ip: ip, decision: "BLOCKED", command: command)
            let notice = "\r\n\u{1b}[31m⛔ Blocked — '\(profile.displayName)' is \(profile.accessMode.label.lowercased()) (\(reason))\u{1b}[0m\r\n"
            terminal.feed(text: notice)
            return false
        }
    }

    private func logCommand(profile: TerminalLaneProfile, ip: String, decision: String, command: String) {
        let entry = CommandLogEntry(
            timestamp: Date(),
            server: profile.displayName,
            ip: ip,
            mode: profile.accessMode.rawValue,
            decision: decision,
            command: command
        )
        TerminalLanePolicy.shared.log.append(entry)
    }

    /// Read the current input line from the terminal buffer at the cursor row.
    private static func pendingLine(of terminal: Terminal) -> String {
        let row = terminal.buffer.y
        guard let line = terminal.getLine(row: row) else { return "" }
        return line.translateToString(trimRight: true)
    }

    /// Strip the shell prompt prefix, keeping the typed command.
    static func stripPrompt(_ line: String) -> String {
        let markers = ["❯ ", "$ ", "% ", "# ", "> "]
        for marker in markers {
            if let r = line.range(of: marker, options: .backwards) {
                return String(line[r.upperBound...]).trimmingCharacters(in: .whitespaces)
            }
        }
        return line.trimmingCharacters(in: .whitespaces)
    }
}

/// LocalProcessTerminalView that runs an input gate on Enter. If the gate blocks,
/// it clears the current line (Ctrl-U to the local PTY) and does not forward Enter.
final class PolicedLocalProcessTerminalView: LocalProcessTerminalView {
    /// Return true to forward the keystrokes, false if blocked.
    var gate: ((_ data: ArraySlice<UInt8>, _ terminal: TerminalView) -> Bool)?

    override func send(source: TerminalView, data: ArraySlice<UInt8>) {
        if data.contains(0x0D), let gate, !gate(data, self) {
            super.send(source: source, data: ArraySlice([0x15])) // Ctrl-U, no newline
            return
        }
        super.send(source: source, data: data)
    }
}

/// Bridges SwiftTerm's plain TerminalView to the native SSH PTY.
final class SSHTerminalCoordinator: NSObject, TerminalViewDelegate {
    private weak var controller: TerminalViewController?
    init(controller: TerminalViewController) { self.controller = controller }

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        controller?.sendSSHInput(data)
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        controller?.resizeSSH(cols: newCols, rows: newRows)
    }
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }
    func clipboardCopy(source: TerminalView, content: Data) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setData(content, forType: .string)
    }
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

extension TerminalViewController: TerminalDisplaySink {
    /// Echo each agent command + its output into the visible terminal so the
    /// operator can watch. Terminals need CR+LF, so normalize newlines.
    func showRun(command: String, output: String) {
        let normalized = output.replacingOccurrences(of: "\n", with: "\r\n")
        let text = "\r\n\u{1b}[36m$ \(command)\u{1b}[0m\r\n\(normalized)\r\n"
        activeTerminalView?.feed(text: text)
    }
}
