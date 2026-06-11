// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DesktopBeeHelper",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "DesktopBeeHelper",
            path: "Sources/DesktopBeeHelper"
        )
    ]
)
