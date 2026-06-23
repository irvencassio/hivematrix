/**
 * Voice command executor for the push-to-talk turn — the IO glue that turns a
 * detected command intent (command-intent.ts) into a real action over the daemon
 * and a spoken reply. This is what lets voice DRIVE HiveMatrix (board, approvals,
 * directives, tasks, connectivity), not just chat. Wired into /voice/turn after the
 * skill picker; returns null to fall through to the conversational LLM reply.
 *
 * Detection + phrasing are the pure tested core; this layer reads state, performs
 * the action, and re-synthesizes the precise spoken answer. Never throws.
 */

import { readFileSync } from "fs";
import {
  detectCommandIntent,
  boardReply, approvalsReply, resolvedReply, noApprovalToResolveReply,
  directivesReply, createdTaskReply, connectivityReply, setConnectivityReply,
  type CommandIntent,
} from "./command-intent";
import { synthesizeSpeech } from "./tts";

export interface CommandTurnOverride {
  reply: string;
  audioBase64: string;
  command: { kind: CommandIntent["kind"]; detail?: string };
}

/** Resolve a detected command to a spoken answer, performing any action. null =
 * not a command, fall through to the LLM. Never throws. */
export async function commandTurnOverride(transcript: string): Promise<CommandTurnOverride | null> {
  const intent = detectCommandIntent(transcript || "");
  if (intent.kind === "none") return null;

  let reply: string | null = null;
  let detail: string | undefined;
  try {
    reply = await runCommand(intent);
  } catch (e) {
    console.error(`[voice-cmd] ${intent.kind} failed: ${e instanceof Error ? e.message : e}`);
    return null; // fall through to the conversational reply on any failure
  }
  if (reply == null) return null;

  let audioBase64 = "";
  try {
    const tts = await synthesizeSpeech(reply);
    audioBase64 = readFileSync(tts.path).toString("base64");
  } catch { /* speak-less fallback: the client shows the text reply */ }

  return { reply, audioBase64, command: { kind: intent.kind, detail } };
}

async function runCommand(intent: CommandIntent): Promise<string | null> {
  switch (intent.kind) {
    case "board": {
      const { Task } = await import("@/lib/db");
      return boardReply(Task.countByStatus());
    }
    case "approvalsList": {
      const { buildApprovalQueue } = await import("@/lib/approvals/queue");
      return approvalsReply(buildApprovalQueue().map((i) => ({ title: i.title, kind: i.kind })));
    }
    case "approve":
    case "deny": {
      const { buildApprovalQueue } = await import("@/lib/approvals/queue");
      const { resolveApproval } = await import("@/lib/orchestrator/approval");
      // Resolve the oldest actionable (non-stuck) approval — the natural "the one
      // you just told me about" target for a voice "approve it".
      const item = buildApprovalQueue().find((i) => i.kind !== "stuck");
      if (!item) return noApprovalToResolveReply();
      const decision = intent.kind === "approve" ? "approve" : "denied";
      await resolveApproval(item.taskId, item.timestamp, decision, "voice");
      return resolvedReply(intent.kind === "approve" ? "approve" : "deny", item.title);
    }
    case "directives": {
      const { listDirectives } = await import("@/lib/orchestrator/directive-store");
      return directivesReply(listDirectives().map((d) => ({ goal: d.goal, status: d.status })));
    }
    case "createTask": {
      const text = (intent.taskText || "").trim();
      if (!text) return null;
      const { Task, generateId } = await import("@/lib/db");
      const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
      const title = text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
      await Task.create({
        _id: generateId(),
        title,
        description: text,
        project: DEFAULT_TASK_PROJECT,
        status: "backlog",
        executor: "agent",
        source: "voice",
      });
      return createdTaskReply(title);
    }
    case "connectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      return connectivityReply(getConnectivityPolicy().mode);
    }
    case "setConnectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      const mode = intent.mode ?? "auto";
      getConnectivityPolicy().setManualOverride(mode === "auto" ? null : mode, "voice command");
      return setConnectivityReply(mode);
    }
    default:
      return null;
  }
}
