/**
 * Autonomy level — a single operator-facing dial for how much approval work
 * requires before it runs and lands. Governs Flights (Work Packages) AND the
 * per-tool approval a chat-escalated task hits (the PreToolUse hook in
 * orchestrator/approval.ts consults this level). Stored under `autonomy` in
 * ~/.hivematrix/config.json (same file + merge-preserving pattern as
 * config/features.ts and voice/auto-approval-policy.ts).
 *
 * Three levels, from most gated to most autonomous:
 *   - manual:     operator Starts every Flight AND accepts every completed item.
 *   - standard:   operator Starts every Flight; low-risk clean items land on
 *                 their own, medium/high-risk items wait in review. (Default —
 *                 preserves historical behaviour.)
 *   - autonomous: Flights start themselves, low-risk clean items land on their
 *                 own, and a task's tool calls run without per-tool approval;
 *                 only the hard safety gates still stop for approval.
 *
 * SAFETY FLOOR — enforced at EVERY level, including autonomous:
 * final-gated items (executionMode "hold" — release / deploy / destructive /
 * credentialed steps) never auto-run, medium/high-risk items never auto-land,
 * the PreToolUse hook still stops for release/deploy/publish/destructive tool
 * calls, and the Mail/Message Lane allowlists still gate outbound sends to
 * non-trusted recipients. The dial changes how much routine, low-risk work
 * flows without a click; it never removes a hard gate.
 */

import { mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { writeJsonAtomic } from "./atomic-write";

export type AutonomyLevel = "manual" | "standard" | "autonomous";

/** UI metadata — order is the display order (most gated → most autonomous). */
export const AUTONOMY_LEVELS: ReadonlyArray<{
  key: AutonomyLevel;
  label: string;
  description: string;
}> = [
  {
    key: "manual",
    label: "Manual — approve everything",
    description:
      "You Start each Flight, and every completed step waits in review for you to accept. Maximum oversight.",
  },
  {
    key: "standard",
    label: "Standard — review results",
    description:
      "You Start each Flight. Low-risk, clean steps land on their own; anything medium/high-risk waits for your review.",
  },
  {
    key: "autonomous",
    label: "Autonomous — run on its own",
    description:
      "Flights start themselves, low-risk work lands automatically, and chat-escalated tasks run their tools without asking. Release, deploy, destructive, and high-risk steps still stop for approval, and Mail/Message sends to non-allowlisted recipients still wait for you.",
  },
];

const DEFAULT_LEVEL: AutonomyLevel = "standard";
const VALID = new Set<AutonomyLevel>(["manual", "standard", "autonomous"]);

function configPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Coerce any stored/incoming value to a valid level; unknown → the default. */
export function parseAutonomyLevel(input: unknown): AutonomyLevel {
  return typeof input === "string" && VALID.has(input as AutonomyLevel)
    ? (input as AutonomyLevel)
    : DEFAULT_LEVEL;
}

export function getAutonomyLevel(): AutonomyLevel {
  return parseAutonomyLevel(readConfig().autonomy);
}

/** Persist a level, merging into config.json without disturbing anything else. */
export function setAutonomyLevel(level: unknown): AutonomyLevel {
  const next = parseAutonomyLevel(level);
  const config = readConfig();
  config.autonomy = next;
  writeJsonAtomic(configPath(), config);
  return next;
}

