import { getDb } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";
import { Artifact, type ArtifactRow } from "@/lib/artifacts/store";
import {
  ARTIFACT_RETENTION_DAYS,
  ARTIFACT_RETENTION_INTERVAL_MS,
} from "@/lib/config/constants";

export function runArtifactRetention(): number {
  const db = getDb();
  const rows = db.prepare(
    `SELECT _id FROM artifacts
     WHERE state = 'active'
       AND datetime(createdAt) < datetime('now', ?)`
  ).all(`-${ARTIFACT_RETENTION_DAYS} days`) as Pick<ArtifactRow, "_id">[];

  if (rows.length === 0) return 0;

  let touched = 0;
  for (const { _id } of rows) {
    Artifact.setState(_id, "archived");
    const updated = Artifact.findById(_id);
    if (updated) {
      broadcast({ type: "artifact:updated", artifactId: _id, fields: updated });
      touched++;
    }
  }
  return touched;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startArtifactRetention(): void {
  if (timer) return;
  // Run once shortly after boot, then on the interval.
  setTimeout(() => {
    try {
      const n = runArtifactRetention();
      if (n > 0) console.log(`[artifacts] retention archived ${n} artifact(s)`);
    } catch (err) {
      console.error("[artifacts] retention run failed:", err);
    }
  }, 30_000);

  timer = setInterval(() => {
    try {
      const n = runArtifactRetention();
      if (n > 0) console.log(`[artifacts] retention archived ${n} artifact(s)`);
    } catch (err) {
      console.error("[artifacts] retention run failed:", err);
    }
  }, ARTIFACT_RETENTION_INTERVAL_MS);
}

export function stopArtifactRetention(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
