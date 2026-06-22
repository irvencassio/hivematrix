/**
 * VoiceBee session contract — the control-plane side of live voice (DECISIONS
 * Q12). Per the prior VoiceBee design, the realtime audio loop runs in the
 * Pipecat sidecar (the runtime owns audio); Hive stays the control plane. When a
 * spoken conversation needs deeper work — or simply ends with a real request —
 * the sidecar hands the transcript here and HiveMatrix turns it into a task,
 * exactly as the brain design specifies ("voice notes imported as task artifacts
 * instead of a separate memory or approval model").
 *
 * This module is PURE: it shapes a VoiceSession into a Task input and decides
 * whether a handoff is warranted. The transport + sidecar wiring (P2.1/P2.2)
 * call into it; nothing here touches audio, the network, or the DB.
 */

export type VoiceSurface = "mac" | "ios" | "phone";

export interface VoiceTurn {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp, optional. */
  at?: string;
}

export interface VoiceSession {
  sessionId: string;
  surface: VoiceSurface;
  /** Phone number / device handle of the speaker, when known. */
  handle?: string;
  startedAt: string;
  endedAt?: string;
  turns: VoiceTurn[];
}

export interface VoiceRouteOptions {
  /** Sidecar flag: the live model couldn't fully answer and asked to escalate. */
  escalated?: boolean;
}

export type VoiceHandoff =
  | { kind: "none"; reason: string }
  | { kind: "task"; title: string; description: string };

export interface VoiceSessionInput {
  session: VoiceSession;
  escalated: boolean;
}

/**
 * Parse + validate an inbound /voice/session request body into a VoiceSession.
 * Returns `{ error }` for a missing sessionId. `now` is injectable for tests.
 */
export function parseVoiceSessionBody(
  body: Record<string, unknown>,
  now: () => string = () => new Date().toISOString(),
): VoiceSessionInput | { error: string } {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) return { error: "sessionId is required" };
  const surface: VoiceSurface = body.surface === "mac" ? "mac" : body.surface === "phone" ? "phone" : "ios";
  const handle = typeof body.handle === "string" ? body.handle : undefined;
  const turns: VoiceTurn[] = (Array.isArray(body.turns) ? body.turns : []).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return {
      role: o.role === "assistant" ? "assistant" as const : "user" as const,
      text: typeof o.text === "string" ? o.text : "",
    };
  }).filter((t) => t.text.trim());
  return {
    session: {
      sessionId, surface, handle,
      startedAt: typeof body.startedAt === "string" ? body.startedAt : now(),
      endedAt: typeof body.endedAt === "string" ? body.endedAt : undefined,
      turns,
    },
    escalated: body.escalated === true,
  };
}

const MAX_TITLE = 70;

function firstUserText(session: VoiceSession): string {
  const t = session.turns.find((x) => x.role === "user" && x.text.trim());
  return t ? t.text.trim() : "";
}

/** A short task title from the first real user utterance. */
export function deriveVoiceTitle(session: VoiceSession): string {
  const first = firstUserText(session);
  if (!first) return "Voice session";
  const oneLine = first.replace(/\s+/g, " ").trim();
  const clipped = oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1).trimEnd()}…` : oneLine;
  return `Voice: ${clipped}`;
}

/** Render the conversation transcript as a task description. */
export function buildVoiceTaskDescription(session: VoiceSession, escalated?: boolean): string {
  const who = session.handle ? `${session.surface} · ${session.handle}` : session.surface;
  const header = [
    escalated
      ? `Voice session (${who}) — task created from voice. Complete the user's request below.`
      : `Voice session (${who}) — transcript follows. Treat the user's spoken words as the request.`,
    "",
    "--- Transcript ---",
  ];
  const lines = session.turns
    .filter((t) => t.text.trim())
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.trim()}`);
  return [...header, ...(lines.length ? lines : ["(no transcript captured)"])].join("\n");
}

/**
 * Decide whether a finished/escalating voice session becomes a Hive task.
 *
 * A task is spawned when the sidecar escalated, OR when there is a substantive
 * user request (a user turn of ≥3 words). Pure greetings / chit-chat that the
 * live model already handled need no task — that would just clutter the board.
 */
export function routeVoiceSession(session: VoiceSession, opts: VoiceRouteOptions = {}): VoiceHandoff {
  const userTurns = session.turns.filter((t) => t.role === "user" && t.text.trim());
  if (userTurns.length === 0) return { kind: "none", reason: "no user utterances" };

  const substantive = userTurns.some((t) => t.text.trim().split(/\s+/).length >= 3);
  if (!opts.escalated && !substantive) {
    return { kind: "none", reason: "trivial exchange handled live" };
  }

  return {
    kind: "task",
    title: deriveVoiceTitle(session),
    description: buildVoiceTaskDescription(session, opts.escalated),
  };
}
