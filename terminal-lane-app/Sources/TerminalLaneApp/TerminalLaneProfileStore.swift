import Foundation

final class TerminalLaneProfileStore {
    static let shared = TerminalLaneProfileStore()
    private let fileURL: URL

    init() {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("Terminal Lane")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("profiles.json")
    }

    func load() -> [TerminalLaneProfile] {
        guard let data = try? Data(contentsOf: fileURL) else { return [TerminalLaneProfile.localDefault()] }
        let decoded = (try? JSONDecoder().decode([TerminalLaneProfile].self, from: data)) ?? []
        return decoded.isEmpty ? [TerminalLaneProfile.localDefault()] : decoded
    }

    func save(_ profiles: [TerminalLaneProfile]) throws {
        let data = try JSONEncoder().encode(profiles)
        try data.write(to: fileURL, options: [.atomic])
    }

    func upsert(_ profile: TerminalLaneProfile) throws {
        var profiles = load()
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
        } else {
            profiles.append(profile)
        }
        try save(profiles)
    }

    enum StoreError: LocalizedError {
        case cannotDeleteLocalDefault
        var errorDescription: String? {
            switch self {
            case .cannotDeleteLocalDefault: return "The local default profile cannot be deleted."
            }
        }
    }

    func delete(id: String) throws {
        guard id != "local" else { throw StoreError.cannotDeleteLocalDefault }
        var profiles = load().filter { $0.id != id }
        if profiles.isEmpty { profiles = [TerminalLaneProfile.localDefault()] }
        try save(profiles)
    }
}
