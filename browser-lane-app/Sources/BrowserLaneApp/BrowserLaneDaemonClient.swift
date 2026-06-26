import Foundation

/// One per-site row from the daemon `/browser-lane/dashboard` aggregate. Metadata
/// only — the non-secret credentialRef/session label, never credentials.
struct BrowserLaneDashboardSite {
    let id: String
    let displayName: String
    let authStrategy: String
    let providerAccount: String?
    let loginUrl: String?
    let credentialRef: String?
    let color: String
    let statusLabel: String
    let summary: String
    let lastRunAt: String?
    let stale: Bool
}

final class BrowserLaneDaemonClient {
    static let shared = BrowserLaneDaemonClient()

    private var baseURL: URL {
        URL(string: BrowserLaneSettings.shared.daemonURL) ?? URL(string: "http://127.0.0.1:3747")!
    }

    func sync(site: BrowserLaneSite, completion: @escaping (Result<String, Error>) -> Void) {
        guard let token = readAuthToken() else {
            completion(.success("saved locally; daemon token not found"))
            return
        }

        var request = URLRequest(url: baseURL.appendingPathComponent("/browser-lane/sites"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "site": [
                "id": site.id,
                "displayName": site.displayName,
                "homeUrl": site.homeUrl,
                "loginUrl": site.loginUrl,
                "allowedDomains": site.allowedDomains,
                "credentialRef": site.credentialRef,
                "authStrategy": site.authStrategy,
                "providerAccount": site.providerAccount ?? "",
                "notes": site.notes,
            ],
        ])

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.success("saved locally; daemon sync failed: \(error.localizedDescription)"))
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(code)"
                completion(.success("saved locally; daemon sync failed: \(detail)"))
                return
            }
            completion(.success("saved locally and synced to HiveMatrix"))
        }.resume()
    }

    /// GET /browser-lane/dashboard — per-site readiness aggregate.
    func fetchDashboard(completion: @escaping (Result<[BrowserLaneDashboardSite], Error>) -> Void) {
        guard let token = readAuthToken() else {
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found at ~/.hivematrix/auth-token."])))
            return
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("/browser-lane/dashboard"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code), let data else {
                completion(.failure(NSError(domain: "BrowserLane", code: code, userInfo: [NSLocalizedDescriptionKey: "Daemon returned HTTP \(code)."])))
                return
            }
            completion(Result { try Self.parseDashboard(data) })
        }.resume()
    }

    /// POST /browser-lane/readiness/run — trigger a live readiness sweep for a site.
    func runReadiness(siteId: String, completion: @escaping (Result<String, Error>) -> Void) {
        post(path: "/browser-lane/readiness/run", body: ["siteId": siteId], completion: completion)
    }

    /// POST /browser-lane/readiness/mark — honest operator-asserted readiness state.
    func markReadiness(siteId: String, state: String, note: String?, completion: @escaping (Result<String, Error>) -> Void) {
        var body: [String: Any] = ["siteId": siteId, "state": state]
        if let note, !note.isEmpty { body["note"] = note }
        post(path: "/browser-lane/readiness/mark", body: body, completion: completion)
    }

    private func post(path: String, body: [String: Any], completion: @escaping (Result<String, Error>) -> Void) {
        guard let token = readAuthToken() else {
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found."])))
            return
        }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(code)"
                completion(.failure(NSError(domain: "BrowserLane", code: code, userInfo: [NSLocalizedDescriptionKey: detail])))
                return
            }
            completion(.success("ok"))
        }.resume()
    }

    private static func parseDashboard(_ data: Data) throws -> [BrowserLaneDashboardSite] {
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let sites = (root?["sites"] as? [[String: Any]]) ?? []
        return sites.map { entry in
            let readiness = entry["readiness"] as? [String: Any] ?? [:]
            return BrowserLaneDashboardSite(
                id: entry["id"] as? String ?? "",
                displayName: entry["displayName"] as? String ?? "",
                authStrategy: entry["authStrategy"] as? String ?? "manual_session",
                providerAccount: entry["providerAccount"] as? String,
                loginUrl: entry["loginUrl"] as? String,
                credentialRef: entry["credentialRef"] as? String,
                color: readiness["color"] as? String ?? "gray",
                statusLabel: readiness["label"] as? String ?? "Unknown",
                summary: readiness["summary"] as? String ?? "",
                lastRunAt: readiness["lastRunAt"] as? String,
                stale: readiness["stale"] as? Bool ?? true
            )
        }
    }

    private func readAuthToken() -> String? {
        let tokenURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
        return try? String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
