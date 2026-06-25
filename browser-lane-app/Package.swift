// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BrowserLaneApp",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "BrowserLane", targets: ["BrowserLaneApp"]),
    ],
    targets: [
        .executableTarget(name: "BrowserLaneApp", path: "Sources/BrowserLaneApp"),
    ]
)
