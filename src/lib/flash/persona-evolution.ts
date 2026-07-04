/**
 * Persona evolution — the agent refines how it operates, from experience.
 *
 * OpenClaw's "aliveness" comes partly from a SOUL.md the agent may evolve. Here
 * that evolution is bounded and safe: a slow (caller-throttled) pass reads the
 * chronic-friction signal (the same recurring backlog clusters pattern-detection
 * uses) and turns the top patterns into concise "operating notes" — e.g. "You
 * repeatedly hit X; account for it." Notes are APPEND-ONLY into a dedicated
 * "## Learned operating notes" section of SOUL.md; the operator-authored core of
 * the soul is never rewritten, and notes are dated/deduped/bounded.
 *
 * The autonomy dial decides apply-vs-propose (honoring "fully autonomous skips
 * extra approvals"):
 *   - autonomous : append the notes to SOUL.md now, announce (flash:persona_updated)
 *                  + audit. Every self-edit is visible — the W8 convention.
 *   - standard / manual : file the notes as proposals in the feedback backlog
 *                  (source "persona-evolution") for the operator to accept; SOUL.md
 *                  is not touched.
 *
 * The note generator is dependency-injected (default: deterministic synthesis
 * from the clusters), so this is fully testable without a model and never lets a
 * model rewrite the whole soul.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { getAutonomyLevel, type AutonomyLevel } from "@/lib/config/autonomy";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import { recordAudit } from "@/lib/audit/audit";
import { listFeedback, recordFeedbackDedup } from "@/lib/feedback/feedback";
import { clusterFeedback, type FeedbackCluster } from "@/lib/feedback/pattern-detection";
import { SOUL_NOTES_SPEC, mergeDatedSection } from "@/lib/brain/persona-section";

export const PERSONA_EVOLUTION_SOURCE = "persona-evolution";
const MAX_NOTES_PER_PASS = 2;
const CLUSTER_MIN_COUNT = 3;

/**
 * Pure default note generator: turn the top chronic clusters into concise
 * operating notes. Deterministic — no model — so evolution is safe and testable.
 */
export function synthesizeOperatingNotes(clusters: FeedbackCluster[], limit = MAX_NOTES_PER_PASS): string[] {
  return clusters.slice(0, limit).map((c) => {
    const verb = c.kind === "bug" ? "has repeatedly gone wrong" : "keeps coming up";
    // No live counts in the note text: a count that grows (3× → 4×) would defeat
    // the containment dedup and append a near-duplicate note every pass.
    return `When working near "${c.exemplarTitle}": this ${verb}. Anticipate it and handle the root cause early.`;
  });
}

/**
 * Pure: append dated operating notes to SOUL.md content under the dedicated
 * section (deduped, bounded — see brain/persona-section). Never rewrites the
 * pre-existing soul body.
 */
export function mergeOperatingNotes(
  existing: string,
  notes: string[],
  date: string,
): { content: string; added: number } {
  return mergeDatedSection(existing, notes, date, SOUL_NOTES_SPEC);
}

export interface PersonaEvolutionDeps {
  /** Generate operating notes from the friction clusters. Default: deterministic synthesis. */
  generateNotes?: (clusters: FeedbackCluster[]) => Promise<string[]> | string[];
  /** Override the autonomy level (tests). */
  autonomyLevel?: AutonomyLevel;
  now?: () => Date;
}

export interface PersonaEvolutionResult {
  clusters: number;
  applied: number;   // notes written to SOUL.md (autonomous)
  proposed: number;  // notes filed as proposals (standard/manual)
}

/**
 * Run one persona-evolution pass. Best-effort — never throws. Reads the chronic
 * backlog, synthesizes bounded operating notes, and either applies them to
 * SOUL.md (autonomous) or files them as proposals (otherwise).
 */
export async function runPersonaEvolution(deps: PersonaEvolutionDeps = {}): Promise<PersonaEvolutionResult> {
  const empty: PersonaEvolutionResult = { clusters: 0, applied: 0, proposed: 0 };
  try {
    const clusters = clusterFeedback(listFeedback(), CLUSTER_MIN_COUNT);
    if (clusters.length === 0) return empty;

    const gen = deps.generateNotes ?? synthesizeOperatingNotes;
    const notes = (await gen(clusters)).filter((n) => n.trim()).slice(0, MAX_NOTES_PER_PASS);
    if (notes.length === 0) return { ...empty, clusters: clusters.length };

    const autonomy = deps.autonomyLevel ?? getAutonomyLevel();
    const now = (deps.now ?? (() => new Date()))();

    if (autonomy === "autonomous") {
      const root = configuredBrainRootDir();
      if (!root) return { ...empty, clusters: clusters.length };
      const applied = applyNotesToSoul(root, notes, now);
      return { clusters: clusters.length, applied, proposed: 0 };
    }

    // standard / manual: propose, don't self-edit the soul.
    let proposed = 0;
    for (const note of notes) {
      const { created } = recordFeedbackDedup({
        kind: "enhancement",
        title: `Persona note: ${note}`.slice(0, 200),
        detail: "Proposed operating note for SOUL.md, synthesized from recurring friction. Accept to fold it into how the agent works.",
        source: PERSONA_EVOLUTION_SOURCE,
      });
      if (created) proposed++;
    }
    return { clusters: clusters.length, applied: 0, proposed };
  } catch (e) {
    console.warn(`[persona-evolution] pass failed: ${e instanceof Error ? e.message : e}`);
    return empty;
  }
}

function applyNotesToSoul(brainRoot: string, notes: string[], now: Date): number {
  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SOUL.md");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const date = now.toISOString().slice(0, 10);
  const { content, added } = mergeOperatingNotes(existing, notes, date);
  if (added === 0) return 0;

  // Timestamped backup, mirroring the persona_update flash tool's convention.
  if (existsSync(path)) writeFileSync(join(dir, `SOUL.md.${now.getTime()}.bak`), readFileSync(path));
  writeFileSync(path, content, "utf-8");

  broadcastEvent("flash:persona_updated", {
    file: "SOUL.md",
    reason: `evolved ${added} operating note(s) from recurring friction`,
    ts: now.toISOString(),
  });
  recordAudit({
    ts: now.toISOString(),
    event: "persona_evolved",
    summary: `Appended ${added} learned operating note(s) to SOUL.md: ${notes.slice(0, added).join(" | ")}`,
  });
  return added;
}
