import Foundation

final class BrowserLaneSiteStore {
    static let shared = BrowserLaneSiteStore()

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileURL: URL? = nil) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Browser Lane", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        self.fileURL = fileURL ?? support.appendingPathComponent("sites.json")
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        self.decoder = JSONDecoder()
    }

    func listSites() -> [BrowserLaneSite] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? decoder.decode([BrowserLaneSite].self, from: data)) ?? []
    }

    func upsert(_ site: BrowserLaneSite) throws {
        var sites = listSites()
        if let index = sites.firstIndex(where: { $0.id == site.id }) {
            sites[index] = site
        } else {
            sites.append(site)
        }
        sites.sort { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
        let data = try encoder.encode(sites)
        try data.write(to: fileURL, options: [.atomic])
    }

    func delete(id: String) throws {
        var sites = listSites()
        sites.removeAll { $0.id == id }
        let data = try encoder.encode(sites)
        try data.write(to: fileURL, options: [.atomic])
    }
}
