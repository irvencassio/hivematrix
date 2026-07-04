/**
 * Autonomy level — a single operator-facing dial for how much approval Flights
 * (Work Packages) require before they run and land. Stored under `autonomy` in
 * ~/.hivematrix/config.json (same file + merge-preserving pattern as
 * config/features.ts and voice/auto-approval-policy.ts).
 *
 * Three levels, from most gated to most autonomous:
 *   - manual:     operator Starts every Flight AND accepts every completed item.
 *   - standard:   operator Starts every Flight; low-risk clean items land on
 *                 their own, medium/high-risk items wait in review. (Default —
 *                 preserves historical behaviour.)
 *   - autonomous: Flights start themselves and low-risk clean items land on
 *                 their own; only the hard safety gates still stop for approval.
 *
 * SAFETY FLOOR — enforced in orchestration at EVERY level, including autonomous:
 * final-gated items (executionMode "hold" — release / deploy / destructive /
 * credentialed steps) never auto-run, and medium/high-risk items never auto-land.
 * The dial changes how much routine, low-risk work flows without a click; it
 * never removes a hard gate.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
      "Flights start themselves and low-risk work lands automatically. Release, deploy, destructive, and high-risk steps still stop for your approval.",
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
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return next;
}

/** True when a freshly-staged Flight should begin without an operator Start. */
export function autonomyAutoStartsFlights(level: AutonomyLevel = getAutonomyLevel()): boolean {
  return level === "autonomous";
}

/**
 * True when a completed low-risk item may land without an operator Accept. False
 * only for `manual`, where the operator reviews every result. This never relaxes
 * the other auto-land gates (risk, blockers, final-gated items) — see shouldAutoLand.
 */
export function autonomyAutoLandsReviews(level: AutonomyLevel = getAutonomyLevel()): boolean {
  return level !== "manual";
}
