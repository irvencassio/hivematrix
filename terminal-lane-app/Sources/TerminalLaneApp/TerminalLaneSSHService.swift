import Foundation
import Citadel
import NIO
import NIOSSH

enum TerminalLaneSSHError: LocalizedError {
    case notConnected
    case connectionFailed(String)
    case authenticationFailed(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: return "Not connected."
        case .connectionFailed(let m): return "Connection failed: \(m)"
        case .authenticationFailed(let m): return "Authentication failed: \(m)"
        }
    }
}

/// Native SSH runtime (Citadel / SwiftNIO). Terminal Lane uses this only for
/// password_keychain profiles, so a session can authenticate with the password
/// read from the macOS Keychain — the same approach Canopy uses. The password
/// is passed in by the caller and never stored on this object beyond the
/// in-flight connect.
actor TerminalLaneSSHService {
    private var client: SSHClient?
    private var ptyTask: Task<Void, Error>?

    var isConnected: Bool { client != nil }

    func connect(host: String, port: Int, user: String, password: String) async throws {
        await disconnect()
        guard !password.isEmpty else { throw TerminalLaneSSHError.authenticationFailed("Password is required.") }
        do {
            client = try await SSHClient.connect(
                host: host,
                port: port,
                authenticationMethod: .passwordBased(username: user, password: password),
                hostKeyValidator: .acceptAnything(),
                reconnect: .never
            )
        } catch {
            throw TerminalLaneSSHError.connectionFailed(error.localizedDescription)
        }
    }

    /// Connect, then immediately disconnect — used by "Test connection" to verify
    /// the Keychain password actually authenticates.
    func verify(host: String, port: Int, user: String, password: String) async throws {
        try await connect(host: host, port: port, user: user, password: password)
        await disconnect()
    }

    /// Opens an interactive PTY. `onOutput` receives stdout/stderr bytes;
    /// `onClose` fires when the remote stream ends. Returns a writer for stdin.
    func openPTY(
        cols: Int,
        rows: Int,
        onOutput: @escaping @Sendable (Data) -> Void,
        onClose: @escaping @Sendable () -> Void
    ) async throws -> TTYStdinWriter {
        guard let client else { throw TerminalLaneSSHError.notConnected }
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<TTYStdinWriter, Error>) in
            let resumed = UnsafeMutablePointer<Bool>.allocate(capacity: 1)
            resumed.initialize(to: false)
            ptyTask = Task {
                defer { resumed.deallocate() }
                do {
                    let request = SSHChannelRequestEvent.PseudoTerminalRequest(
                        wantReply: true,
                        term: "xterm-256color",
                        terminalCharacterWidth: cols,
                        terminalRowHeight: rows,
                        terminalPixelWidth: 0,
                        terminalPixelHeight: 0,
                        terminalModes: .init([:])
                    )
                    try await client.withPTY(request) { inbound, outbound in
                        if !resumed.pointee { resumed.pointee = true; cont.resume(returning: outbound) }
                        for try await event in inbound {
                            switch event {
                            case .stdout(let buffer), .stderr(let buffer):
                                if let bytes = buffer.getBytes(at: buffer.readerIndex, length: buffer.readableBytes) {
                                    onOutput(Data(bytes))
                                }
                            }
                        }
                    }
                    onClose()
                } catch {
                    if !resumed.pointee { resumed.pointee = true; cont.resume(throwing: error) }
                    onClose()
                }
            }
        }
    }

    func disconnect() async {
        ptyTask?.cancel()
        ptyTask = nil
        if let client { try? await client.close() }
        client = nil
    }
}
