import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-persona-evo-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");
process.env.HOME = TMP; // config + audit + brain default all resolve under HOME

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback, setFeedbackStatus } = await import("@/lib/feedback/feedback");
const { setAutonomyLevel } = await import("@/lib/config/autonomy");
const {
  PERSONA_EVOLUTION_SOURCE,
  mergeOperatingNotes,
  synthesizeOperatingNotes,
  runPersonaEvolution,
} = await import("./persona-evolution");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function seedChronic(title: string, n: number) {
  for (let i = 0; i < n; i++) recordFeedback({ kind: "bug", title, source: "test" });
}

test("mergeOperatingNotes appends dated notes without rewriting the soul body", () => {
  const soul = "# SOUL\n\nYou are Vale. You help Irv build his business.\n";
  const { content, added } = mergeOperatingNotes(soul, ["Prefer local models when offline."], "2026-07-04");
  assert.equal(added, 1);
  assert.match(content, /You are Vale\. You help Irv/); // core preserved
  assert.match(content, /## Learned operating notes/);
  assert.match(content, /- 2026-07-04: Prefer local models when offline\./);
});

test("mergeOperatingNotes dedupes and bounds to the newest 25 notes", () => {
  let content = "# SOUL\n";
  for (let i = 0; i < 30; i++) {
    content = mergeOperatingNotes(content, [`Distinct operating lesson number ${i}`], "2026-07-04").content;
  }
  const bullets = content.split("\n").filter((l) => l.trim().startsWith("- "));
  assert.equal(bullets.length, 25);
  assert.match(bullets[24], /number 29/); // newest kept
  // Dedup: re-adding an existing note is a no-op
  const again = mergeOperatingNotes(content, ["distinct operating lesson number 29"], "2026-07-05");
  assert.equal(again.added, 0);
});

test("synthesizeOperatingNotes turns top clusters into concise notes", () => {
  const notes = synthesizeOperatingNotes(
    [
      { normalizedTitle: "x", count: 5, exemplarTitle: "Browser auth expired", kind: "bug", ids: [] },
      { normalizedTitle: "y", count: 4, exemplarTitle: "Wants terse replies", kind: "enhancement", ids: [] },
      { normalizedTitle: "z", count: 3, exemplarTitle: "third", kind: "bug", ids: [] },
    ],
    2,
  );
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Browser auth expired/);
  assert.match(notes[0], /5×/);
});

test("autonomous: evolution appends notes to SOUL.md and announces (no proposals)", async () => {
  setAutonomyLevel("autonomous");
  seedChronic("Terminal session dropped mid-command", 4);
  const result = await runPersonaEvolution({
    now: () => new Date("2026-07-04T12:00:00Z"),
    generateNotes: (clusters) => synthesizeOperatingNotes(clusters, 1),
  });
  assert.equal(result.applied, 1);
  assert.equal(result.proposed, 0);
  // SOUL.md was written under the configured brain root (HOME-based default).
  const soulPath = join(TMP, "_GD", "brain", "persona", "SOUL.md");
  assert.equal(existsSync(soulPath), true);
  assert.match(readFileSync(soulPath, "utf-8"), /## Learned operating notes[\s\S]*Terminal session dropped/);
  // No proposals should have been filed under autonomous.
  assert.equal(listFeedback().filter((f) => f.source === PERSONA_EVOLUTION_SOURCE).length, 0);
});

test("manual/standard: evolution files proposals and leaves SOUL.md untouched", async () => {
  setAutonomyLevel("standard");
  seedChronic("Mail draft never sent", 3);
  const before = listFeedback().filter((f) => f.source === PERSONA_EVOLUTION_SOURCE).length;
  const result = await runPersonaEvolution({
    now: () => new Date("2026-07-04T12:00:00Z"),
    generateNotes: (clusters) => synthesizeOperatingNotes(clusters, 1),
  });
  assert.equal(result.applied, 0);
  assert.ok(result.proposed >= 1);
  const after = listFeedback().filter((f) => f.source === PERSONA_EVOLUTION_SOURCE);
  assert.ok(after.length > before);
  assert.match(after[0].title, /^Persona note:/);
});

test("no chronic clusters → no-op", async () => {
  // Resolve every existing item so no open/triaged cluster remains.
  for (const f of listFeedback()) {
    if (f.status === "open" || f.status === "triaged") setFeedbackStatus(f._id, "done");
  }
  recordFeedback({ kind: "bug", title: "a brand new one-off", source: "test" });
  const result = await runPersonaEvolution({ autonomyLevel: "autonomous" });
  assert.deepEqual(result, { clusters: 0, applied: 0, proposed: 0 });
});
