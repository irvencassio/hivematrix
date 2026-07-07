// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TerminalLaneCore",
    platforms: [.macOS("13.0")],
    products: [
        .library(name: "TerminalLaneCore", targets: ["TerminalLaneCore"]),
    ],
    targets: [
        .target(name: "TerminalLaneCore"),
        .testTarget(name: "TerminalLaneCoreTests", dependencies: ["TerminalLaneCore"]),
    ]
)
