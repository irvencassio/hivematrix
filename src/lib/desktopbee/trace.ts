/**
 * Desktop Lane action-trace artifacts (W2.2).
 *
 * A vision-plane flow's step-by-step trace (targets, grounding, capture refs,
 * postcondition verdicts) is written as a task-scoped artifact — the audit
 * trail the workplan calls for, and the evidence a Citrix flow actually
 * completed. Same artifact path + registration shape as image-gen / content.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { ensureScopeDir } from "@/lib/artifacts/paths";
import { Artifact } from "@/lib/artifacts/store";
import type { VisionRunResult } from "./vision";

export interface VisionTraceResult {
  path: string;
  verified: number;
  total: number;
  ok: boolean;
}

export function writeVisionTrace(
  taskId: string,
  flowName: string,
  result: VisionRunResult,
  stamp: string = "trace",
): VisionTraceResult {
  const dir = ensureScopeDir("task", taskId);
  const filename = `desktopbee-trace-${stamp}.json`;
  const path = join(dir, filename);

  const verified = result.steps.filter((s) => s.verdict === "verified").length;
  const body = JSON.stringify(
    {
      flow: flowName,
      ok: result.ok,
      verified,
      total: result.steps.length,
      steps: result.steps,
    },
    null,
    2,
  );
  writeFileSync(path, body);

  const stem = "desktopbee-trace";
  Artifact.upsert({
    scope: "task",
    scopeId: taskId,
    filename,
    title: `Desktop Lane action trace: ${flowName}`,
    mimeType: "application/json",
    sizeBytes: Buffer.byteLength(body),
    stem,
    versionNum: Artifact.nextVersion("task", taskId, stem),
    metadata: { flow: flowName, ok: result.ok, verified, total: result.steps.length },
  });

  return { path, verified, total: result.steps.length, ok: result.ok };
}
