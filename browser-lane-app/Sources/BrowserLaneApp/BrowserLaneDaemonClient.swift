import Foundation

final class BrowserLaneDaemonClient {
    static let shared = BrowserLaneDaemonClient()

    private let baseURL = URL(string: "http://127.0.0.1:3747")!

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

    private func readAuthToken() -> String? {
        let tokenURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hivematrix")
            .appendingPathComponent("auth-token")
        return try? String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
