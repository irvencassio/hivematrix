import { readFileSync } from "fs";

const PHASE_PATTERNS = [
  { phase: "Phase 1", re: /\b(?:phase\s*1|m1)\b/i },
  { phase: "Phase 2", re: /\b(?:phase\s*2|m2)\b/i },
  { phase: "Phase 3", re: /\b(?:phase\s*3|m3)\b/i },
  { phase: "Phase 4", re: /\b(?:phase\s*4|m4)\b/i },
];

export function claimedPhases(note) {
  const text = String(note ?? "");
  return PHASE_PATTERNS.filter(({ re }) => re.test(text)).map(({ phase }) => phase);
}

export function phaseGateStatuses(markdown) {
  const statuses = new Map();
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (!line.trim().startsWith("| Phase ")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const phase = cells[1];
    const status = cells[4];
    if (/^Phase [1-4]$/.test(phase)) statuses.set(phase, status);
  }
  return statuses;
}

export function assertReleaseNoteGateClaims(note, gatesMarkdown) {
  const claims = claimedPhases(note);
  if (claims.length === 0) return;

  const statuses = phaseGateStatuses(gatesMarkdown);
  const unmet = claims.filter((phase) => statuses.get(phase) !== "PASSED");
  if (unmet.length > 0) {
    throw new Error(
      `release note claims ${unmet.join(", ")} but docs/GATES.md does not mark ${unmet.length === 1 ? "it" : "them"} PASSED`,
    );
  }
}

export function assertReleaseNoteGateClaimsFromFile(note, gatesPath = "docs/GATES.md") {
  assertReleaseNoteGateClaims(note, readFileSync(gatesPath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const note = process.argv.slice(2).join(" ");
  assertReleaseNoteGateClaimsFromFile(note);
}
