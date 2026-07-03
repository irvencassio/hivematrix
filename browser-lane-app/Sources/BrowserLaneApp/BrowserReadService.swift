import Foundation

/// Result of a single Browser Lane read, shaped to the `BrowserLaneReadResult`
/// contract the daemon's read-client expects (`src/lib/browser-lane/read-client.ts`).
///
/// Per the agreed design the app does NOT synthesize a final answer — it returns
/// the extracted page text as `answer` and the on-page links as `citations`, and
/// the requesting model (DeepSeek/Dwarf Star) writes the final answer.
struct BrowserReadResult {
    var status: String                                   // "completed" | "failed"
    var answer: String?
    var citations: [(title: String, url: String, retrievedAt: String)]
    var errorCode: String?

    func jsonData() -> Data {
        let now = ISO8601DateFormatter().string(from: Date())
        let citationObjects: [[String: Any]] = citations.map {
            ["title": $0.title, "url": $0.url, "retrievedAt": $0.retrievedAt]
        }
        var payload: [String: Any] = [
            "status": status,
            "answer": answer as Any? ?? NSNull(),
            "citations": citationObjects,
            "confidence": status == "completed" ? 0.5 : 0.0,
            "freshnessVerifiedAt": status == "completed" ? now : NSNull(),
            "escalation": ["needed": false, "reason": NSNull(), "target": NSNull()],
            "artifacts": [],
        ]
        if let errorCode { payload["errorCode"] = errorCode }
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{\"status\":\"failed\"}".utf8)
    }

    static func failed(_ code: String) -> BrowserReadResult {
        BrowserReadResult(status: "failed", answer: nil, citations: [], errorCode: code)
    }
}

/// Implemented by the live `BrowserViewController` — drives the visible WebKit
/// view so the operator can watch each agent read happen.
protocol BrowserReadDriver: AnyObject {
    func performRead(query: String, completion: @escaping (BrowserReadResult) -> Void)
}

/// Bridge between the loopback HTTP server (background queue) and the WebKit view
/// (main thread). Holds a weak reference to the active browser controller.
final class BrowserReadService {
    static let shared = BrowserReadService()
    weak var driver: BrowserReadDriver?

    func answer(query: String, completion: @escaping (BrowserReadResult) -> Void) {
        DispatchQueue.main.async {
            guard let driver = self.driver else {
                completion(.failed("browser_lane_window_closed"))
                return
            }
            driver.performRead(query: query, completion: completion)
        }
    }
}
