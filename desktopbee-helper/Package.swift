// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DesktopBeeHelper",
    // EventKit's requestFullAccessToEvents(completion:) needs macOS 14+; the
    // calendar subcommand (P0.1) is the reason the whole helper now targets 14.
    platforms: [.macOS(.v14)],
    targets: [
        // Pure, TCC-free types/logic shared with the test target. SwiftPM
        // test targets cannot depend on an executableTarget directly, so the
        // calendar JSON-encoding logic lives here and DesktopBeeHelper (the
        // executable) depends on it.
        .target(
            name: "DesktopBeeHelperCore",
            path: "Sources/DesktopBeeHelperCore"
        ),
        .executableTarget(
            name: "DesktopBeeHelper",
            dependencies: ["DesktopBeeHelperCore"],
            path: "Sources/DesktopBeeHelper"
        ),
        .testTarget(
            name: "DesktopBeeHelperCoreTests",
            dependencies: ["DesktopBeeHelperCore"],
            path: "Tests/DesktopBeeHelperCoreTests"
        ),
    ]
)
