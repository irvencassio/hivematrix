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
    /// nil when an older daemon omits it — the caller then falls back to its own
    /// copy rather than silently reporting read-write.
    let accessMode: String?
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
            // A sync that did not happen is reported as a failure, not success, so
            // the UI never dresses up "daemon unreachable" as "saved + synced".
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "daemon auth token not found"])))
            return
        }

        var request = URLRequest(url: url(path: "/browser-lane/sites"))
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
                "accessMode": site.access.rawValue,
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
        var request = URLRequest(url: url(path: "/browser-lane/dashboard"))
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

    /// POST /browser-lane/sites/:id/credential-used — audit-only signal that a
    /// saved credential was retrieved for manual sign-in. Never carries the secret.
    func recordCredentialUse(siteId: String, completion: @escaping (Result<String, Error>) -> Void = { _ in }) {
        post(path: "/browser-lane/sites/\(siteId)/credential-used", body: [:], completion: completion)
    }

    private func post(path: String, body: [String: Any], completion: @escaping (Result<String, Error>) -> Void) {
        guard let token = readAuthToken() else {
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found."])))
            return
        }
        var request = URLRequest(url: url(path: path))
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

    private func getText(path: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let token = readAuthToken() else {
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found."])))
            return
        }
        var request = URLRequest(url: url(path: path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code), let data else {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(code)"
                completion(.failure(NSError(domain: "BrowserLane", code: code, userInfo: [NSLocalizedDescriptionKey: detail])))
                return
            }
            completion(.success(Self.prettyJSON(data) ?? String(data: data, encoding: .utf8) ?? "{}"))
        }.resume()
    }

    /// GET /browser-lane/history — `browser:*` audit entries for the Command Log,
    /// newest first. Filtering is done daemon-side so the app never holds more
    /// history than it shows.
    /// Actor/status filtering is done in the panel (one fetch, instant chips), so
    /// only the site scope and limit are pushed down to the daemon.
    func fetchHistory(
        target: String? = nil,
        limit: Int = 200,
        completion: @escaping (Result<[BrowserLaneHistoryEntry], Error>) -> Void
    ) {
        guard let token = readAuthToken() else {
            completion(.failure(NSError(domain: "BrowserLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found at ~/.hivematrix/auth-token."])))
            return
        }
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let target, !target.isEmpty { items.append(URLQueryItem(name: "target", value: target)) }
        guard let endpoint = url(path: "/browser-lane/history", query: items) else {
            completion(.failure(NSError(domain: "BrowserLane", code: 400, userInfo: [NSLocalizedDescriptionKey: "Could not build history URL."])))
            return
        }
        var request = URLRequest(url: endpoint)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code), let data else {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(code)"
                completion(.failure(NSError(domain: "BrowserLane", code: code, userInfo: [NSLocalizedDescriptionKey: detail])))
                return
            }
            do { completion(.success(try Self.parseHistory(data))) } catch { completion(.failure(error)) }
        }.resume()
    }

    private static func parseHistory(_ data: Data) throws -> [BrowserLaneHistoryEntry] {
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let entries = (root?["entries"] as? [[String: Any]]) ?? []
        return entries.map { entry in
            BrowserLaneHistoryEntry(
                ts: entry["ts"] as? String ?? "",
                event: entry["event"] as? String ?? "",
                actor: entry["actor"] as? String ?? "unknown",
                actorKind: entry["actorKind"] as? String ?? "",
                target: entry["target"] as? String ?? "",
                status: entry["status"] as? String ?? "",
                summary: entry["summary"] as? String ?? ""
            )
        }
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
                accessMode: entry["accessMode"] as? String,
                color: readiness["color"] as? String ?? "gray",
                statusLabel: readiness["label"] as? String ?? "Unknown",
                summary: readiness["summary"] as? String ?? "",
                lastRunAt: readiness["lastRunAt"] as? String,
                stale: readiness["stale"] as? Bool ?? true
            )
        }
    }

    private static func prettyJSON(_ data: Data) -> String? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        else { return nil }
        return String(data: pretty, encoding: .utf8)
    }

    private func url(path: String) -> URL {
        baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    /// Query-string variant. `appendingPathComponent` would percent-encode a "?..."
    /// suffix into the path, so anything with query items must build via URLComponents.
    private func url(path: String, query: [URLQueryItem]) -> URL? {
        var components = URLComponents(url: url(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query
        return components?.url
    }

    private func readAuthToken() -> String? {
        let tokenURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
        return try? String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
