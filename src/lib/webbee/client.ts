const DEFAULT_WEBBEE_BASE_URL = "http://127.0.0.1:4011";

export interface WebBeeAnswerRequest {
  query: string;
  requestedBy: string;
  project: string;
  missionId?: string | null;
  userLocale?: string;
  timeZone?: string;
  locationHints?: string[];
  freshness?: "low" | "medium" | "high";
  maxLatencyMs?: number;
  citationStyle?: "compact" | "full";
  allowBrowserEscalation?: boolean;
}

export interface WebBeeAnswerResult {
  status: "completed" | "failed" | "needs_escalation";
  answer: string | null;
  citations: Array<{ title: string; url: string; retrievedAt: string }>;
  confidence: number;
  freshnessVerifiedAt: string | null;
  escalation: {
    needed: boolean;
    reason: string | null;
    target?: "browserbee" | null;
  };
  artifacts: string[];
  errorCode?: string;
}

export function resolveWebBeeBaseUrl(): string {
  const configured = process.env.WEBBEE_BASE_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_WEBBEE_BASE_URL).replace(/\/$/, "");
}

export async function requestWebBeeAnswer(request: WebBeeAnswerRequest): Promise<Response> {
  return fetch(`${resolveWebBeeBaseUrl()}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobType: "answer_query",
      intent: "fresh_public_data",
      requestedBy: request.requestedBy,
      project: request.project,
      missionId: request.missionId ?? null,
      freshness: request.freshness ?? "high",
      riskLevel: "low",
      approvalMode: "auto",
      artifactPolicy: "none",
      tracePolicy: "none",
      query: request.query,
      userLocale: request.userLocale ?? "en-US",
      timeZone: request.timeZone ?? "America/New_York",
      locationHints: request.locationHints ?? [],
      maxLatencyMs: request.maxLatencyMs ?? 8_000,
      citationStyle: request.citationStyle ?? "compact",
      allowBrowserEscalation: request.allowBrowserEscalation ?? false,
    }),
  });
}
