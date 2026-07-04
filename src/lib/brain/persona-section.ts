/**
 * Dated persona-file sections — the ONE implementation of the pattern used by
 * operator modeling (USER.md), the goal ledger (GOALS.md), and persona
 * evolution (SOUL.md operating notes): dated bullets appended under a named
 * `## Section` header, deduped by normalized containment, bounded to the
 * newest N, never rewriting content outside the section's bullet list.
 *
 * Pure functions only — callers own file IO and announcements.
 */

export interface DatedSectionSpec {
  /** The exact section header line, e.g. "## Active goals". */
  header: string;
  /** Full seed document used when the file is empty/missing. Must contain or precede the header. */
  seed: string;
  /** Keep only the newest N bullets in the section. */
  maxItems: number;
}

/** USER.md — durable operator facts learned from real conversations. */
export const USER_SECTION_SPEC: DatedSectionSpec = {
  header: "## Learned about the operator",
  seed: "# USER — who the operator is\n\nMaintained by the agent from real conversations.",
  maxItems: 40,
};

/** GOALS.md — the goal ledger. Brain doc only; never rendered as product UI. */
export const GOALS_SECTION_SPEC: DatedSectionSpec = {
  header: "## Active goals",
  seed: "# GOALS — what the operator is working toward\n\nMaintained by the agent from real conversations. Edit freely; the agent anchors briefs and priorities to this file.",
  maxItems: 40,
};

/** SOUL.md operating notes — persona evolution's append-only section. */
export const SOUL_NOTES_SPEC: DatedSectionSpec = {
  header: "## Learned operating notes",
  seed: "# SOUL\n\nYou are becoming someone. This file is yours to evolve.",
  maxItems: 25,
};

export function normalizeBullet(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** All bullet lines in a document, with any leading "YYYY-MM-DD:" date stripped. */
export function parseSectionBullets(content: string): string[] {
  return content
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim().replace(/^-\s*/, "").replace(/^\d{4}-\d{2}-\d{2}:\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Merge fresh items into the document as dated bullets INSIDE the spec's
 * section — inserted before the next `## ` header (or the doc end), so content
 * in later, possibly operator-authored sections is never touched. Dedupe: an
 * item is skipped when any existing bullet anywhere in the doc contains it or
 * is contained by it after normalization (and within the incoming batch).
 * Bounding keeps only the newest maxItems bullets of THIS section.
 */
export function mergeDatedSection(
  existing: string,
  items: string[],
  date: string,
  spec: DatedSectionSpec,
): { content: string; added: number } {
  const base = existing.trim() ? existing.replace(/\s+$/, "") : spec.seed.replace(/\s+$/, "");

  const existingBullets = base
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => normalizeBullet(l));

  const fresh: string[] = [];
  for (const item of items) {
    const cleaned = item.trim().replace(/\s+/g, " ");
    const norm = normalizeBullet(cleaned);
    if (!cleaned || !norm) continue;
    const known = existingBullets.some((b) => b.includes(norm) || norm.includes(b));
    const dup = fresh.some((f) => {
      const fn = normalizeBullet(f);
      return fn.includes(norm) || norm.includes(fn);
    });
    if (!known && !dup) fresh.push(cleaned);
  }
  if (fresh.length === 0) return { content: existing, added: 0 };

  const doc = base.includes(spec.header) ? base : `${base}\n\n${spec.header}`;

  // Section bounds: from the header line to the next "## " header or doc end.
  const headerStart = doc.indexOf(spec.header);
  const afterHeader = headerStart + spec.header.length;
  const nextHeaderRel = doc.slice(afterHeader).search(/\n##\s/);
  const sectionEnd = nextHeaderRel === -1 ? doc.length : afterHeader + nextHeaderRel;

  const before = doc.slice(0, sectionEnd).replace(/\s+$/, "");
  const after = doc.slice(sectionEnd);

  let section = before;
  for (const item of fresh) section += `\n- ${date}: ${item}`;

  // Bound: keep the newest maxItems bullets WITHIN this section only.
  const sectionLines = section.slice(afterHeader).split("\n");
  const bulletIdx = sectionLines.map((l, i) => (l.trim().startsWith("- ") ? i : -1)).filter((i) => i >= 0);
  if (bulletIdx.length > spec.maxItems) {
    const drop = new Set(bulletIdx.slice(0, bulletIdx.length - spec.maxItems));
    section = section.slice(0, afterHeader) + sectionLines.filter((_, i) => !drop.has(i)).join("\n");
  }

  const content = section + (after.trim() ? `\n${after.replace(/^\n+/, "\n")}` : "\n");
  return { content, added: fresh.length };
}
