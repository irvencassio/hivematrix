import Foundation

final class TerminalLaneDaemonClient {
    static let shared = TerminalLaneDaemonClient()
    private var baseURL: URL {
        URL(string: TerminalLaneSettings.shared.daemonURL) ?? URL(string: "http://127.0.0.1:3747")!
    }

    func sync(profile: TerminalLaneProfile, completion: @escaping (Result<String, Error>) -> Void) {
        post(path: "/terminal-lane/profiles", body: [
            "profile": [
                "id": profile.id,
                "displayName": profile.displayName,
                "kind": profile.kind.rawValue,
                "host": profile.host as Any,
                "user": profile.user as Any,
                "port": profile.port as Any,
                "shell": profile.shell as Any,
                "cwd": profile.cwd as Any,
                "credentialRef": profile.credentialRef as Any,
                "openCommand": profile.openCommand,
                "notes": profile.notes,
            ],
        ], completion: completion)
    }

    func runReadiness(profileId: String, completion: @escaping (Result<String, Error>) -> Void) {
        post(path: "/terminal-lane/readiness/run", body: ["profileId": profileId], completion: completion)
    }

    func fetchDashboard(completion: @escaping (Result<[TerminalLaneDashboardProfile], Error>) -> Void) {
        guard let request = request(path: "/terminal-lane/dashboard") else {
            completion(.failure(NSError(domain: "TerminalLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found."])))
            return
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code), let data else {
                completion(.failure(NSError(domain: "TerminalLane", code: code, userInfo: [NSLocalizedDescriptionKey: "Daemon returned HTTP \(code)."])))
                return
            }
            completion(Result { try Self.parseDashboard(data) })
        }.resume()
    }

    func fetchTraces(completion: @escaping (Result<String, Error>) -> Void) {
        guard let request = request(path: "/terminal-lane/traces") else {
            completion(.failure(NSError(domain: "TerminalLane", code: 401, userInfo: [NSLocalizedDescriptionKey: "Daemon auth token not found."])))
            return
        }
        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error { completion(.failure(error)); return }
            completion(.success(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"))
        }.resume()
    }

    private func post(path: String, body: [String: Any], completion: @escaping (Result<String, Error>) -> Void) {
        guard var request = request(path: path) else {
            completion(.success("saved locally; daemon auth token not found"))
            return
        }
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
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

    private func request(path: String) -> URLRequest? {
        guard let auth = readAuthToken() else { return nil }
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func readAuthToken() -> String? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
        return try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func parseDashboard(_ data: Data) throws -> [TerminalLaneDashboardProfile] {
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let profiles = (root?["profiles"] as? [[String: Any]]) ?? []
        return profiles.map { entry in
            let readiness = entry["readiness"] as? [String: Any] ?? [:]
            return TerminalLaneDashboardProfile(
                id: entry["id"] as? String ?? "",
                displayName: entry["displayName"] as? String ?? "",
                kind: entry["kind"] as? String ?? "",
                host: entry["host"] as? String,
                user: entry["user"] as? String,
                credentialRef: entry["credentialRef"] as? String,
                color: readiness["color"] as? String ?? "gray",
                status: readiness["status"] as? String ?? "unknown",
                summary: readiness["summary"] as? String ?? "",
                lastRunAt: readiness["lastRunAt"] as? String
            )
        }
    }
}
