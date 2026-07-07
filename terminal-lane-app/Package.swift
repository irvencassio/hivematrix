// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TerminalLaneApp",
    // Citadel's native PTY API (SSHClient.withPTY) requires macOS 15.
    platforms: [.macOS("15.0")],
    products: [
        .executable(name: "TerminalLane", targets: ["TerminalLaneApp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0"),
        // Native Swift SSH client (SwiftNIO) so password profiles auto-connect
        // with the Keychain password — the same runtime Canopy uses.
        .package(url: "https://github.com/orlandos-nl/Citadel.git", exact: "0.12.0"),
    ],
    targets: [
        .executableTarget(
            name: "TerminalLaneApp",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "Citadel", package: "Citadel"),
            ],
            path: "Sources/TerminalLaneApp"
        ),
    ]
)
