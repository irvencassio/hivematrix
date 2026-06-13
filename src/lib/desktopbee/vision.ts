/**
 * DesktopBee vision plane (W2.2) — the orchestration layer.
 *
 * The live pipeline is: ScreenCaptureKit capture → Apple Vision OCR pre-pass →
 * Qwen3.6 multimodal grounding → CGEvent click/type, postcondition-verified,
 * with the step-by-step action trace stored as an artifact. The native bits
 * (capture/OCR/model-grounding/input) are macOS-only and live behind injectable
 * *seams* so the control flow — ground, act, re-capture, verify — is fully
 * testable here and the native helper plugs in unchanged.
 *
 * Exact-text targets ground deterministically from the OCR boxes (no model
 * needed); semantic ("describe") targets defer to the model seam. The default
 * seams report "not wired" rather than pretending — the offline Citrix prover
 * is a live-Mac gate, NOT something this module claims to have passed.
 */

export interface VisionFrame {
  capturePath: string;
}

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisionTarget {
  kind: "text" | "describe";
  value: string;
}

export interface VisionExpectation {
  kind: "text_present" | "text_absent";
  value: string;
}

export interface VisionStep {
  target: VisionTarget;
  action: "click" | "type";
  text?: string;
  expect?: VisionExpectation;
}

export interface GroundingResult {
  found: boolean;
  x?: number;
  y?: number;
  confidence: number;
  via: "ocr" | "model" | "none";
  note: string;
}

export interface VisionSeams {
  capture: () => Promise<VisionFrame>;
  ocr: (frame: VisionFrame) => Promise<OcrBox[]>;
  click: (x: number, y: number) => Promise<void>;
  type: (text: string) => Promise<void>;
  ground?: (target: VisionTarget, boxes: OcrBox[], frame: VisionFrame) => Promise<GroundingResult>;
}

export type VisionVerdict = "verified" | "unverified" | "failed";

export interface VisionStepTrace {
  index: number;
  target: VisionTarget;
  action: "click" | "type";
  grounding: GroundingResult;
  beforeCapture: string;
  afterCapture: string;
  verdict: VisionVerdict;
  note: string;
}

export interface VisionRunResult {
  ok: boolean;
  steps: VisionStepTrace[];
}

/** Deterministic grounding from an OCR pre-pass: center of the first box whose text contains the target. */
export function groundViaOcr(target: VisionTarget, boxes: OcrBox[]): GroundingResult {
  const needle = target.value.trim().toLowerCase();
  if (!needle) return { found: false, confidence: 0, via: "none", note: "empty target" };
  let best: OcrBox | null = null;
  let bestScore = 0;
  for (const box of boxes) {
    const hay = box.text.toLowerCase();
    if (!hay.includes(needle)) continue;
    // Exact match scores highest; otherwise score by how much of the box the needle covers.
    const score = hay === needle ? 1 : needle.length / Math.max(hay.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = box;
    }
  }
  if (!best) return { found: false, confidence: 0, via: "none", note: `no OCR box matched "${target.value}"` };
  return {
    found: true,
    x: Math.round(best.x + best.w / 2),
    y: Math.round(best.y + best.h / 2),
    confidence: bestScore,
    via: "ocr",
    note: `matched OCR box "${best.text}"`,
  };
}

/** Postcondition check against the post-action OCR boxes. */
export function verifyExpectation(expect: VisionExpectation, afterBoxes: OcrBox[]): boolean {
  const needle = expect.value.trim().toLowerCase();
  const present = afterBoxes.some((b) => b.text.toLowerCase().includes(needle));
  return expect.kind === "text_present" ? present : !present;
}

async function groundStep(target: VisionTarget, boxes: OcrBox[], frame: VisionFrame, seams: VisionSeams): Promise<GroundingResult> {
  if (target.kind === "text") {
    const ocrResult = groundViaOcr(target, boxes);
    if (ocrResult.found || !seams.ground) return ocrResult;
    return seams.ground(target, boxes, frame);
  }
  if (!seams.ground) {
    return { found: false, confidence: 0, via: "none", note: "describe target needs model grounding (seam not wired)" };
  }
  return seams.ground(target, boxes, frame);
}

/** Run one step: capture → ocr → ground → act → re-capture → verify postcondition. */
export async function runVisionStep(index: number, step: VisionStep, seams: VisionSeams): Promise<VisionStepTrace> {
  const before = await seams.capture();
  const beforeBoxes = await seams.ocr(before);
  const grounding = await groundStep(step.target, beforeBoxes, before, seams);

  let verdict: VisionVerdict;
  let note: string;

  if (!grounding.found) {
    verdict = "failed";
    note = `grounding failed: ${grounding.note}`;
  } else {
    await seams.click(grounding.x!, grounding.y!);
    if (step.action === "type") await seams.type(step.text ?? "");
    note = "action dispatched";
  }

  const after = await seams.capture();
  const afterBoxes = await seams.ocr(after);

  if (grounding.found) {
    if (!step.expect) {
      verdict = "verified";
    } else {
      verdict = verifyExpectation(step.expect, afterBoxes) ? "verified" : "unverified";
      note = `postcondition ${step.expect.kind} "${step.expect.value}" → ${verdict}`;
    }
  } else {
    verdict = "failed";
  }

  return {
    index,
    target: step.target,
    action: step.action,
    grounding,
    beforeCapture: before.capturePath,
    afterCapture: after.capturePath,
    verdict,
    note,
  };
}

/** Run a flow of steps; ok only when every step verified its postcondition. */
export async function runVisionFlow(steps: VisionStep[], seams: VisionSeams): Promise<VisionRunResult> {
  const traces: VisionStepTrace[] = [];
  for (let i = 0; i < steps.length; i++) {
    traces.push(await runVisionStep(i, steps[i], seams));
  }
  return { ok: traces.length > 0 && traces.every((t) => t.verdict === "verified"), steps: traces };
}

/**
 * Default seams — honest "not wired" stubs. The native plane (ScreenCaptureKit
 * capture, Apple Vision OCR, Qwen multimodal grounding, CGEvent input) replaces
 * these on a live Mac; until then a flow runs to an all-failed trace with a
 * clear note rather than crashing or pretending.
 */
export function unavailableVisionSeams(): VisionSeams {
  let n = 0;
  return {
    capture: async () => ({ capturePath: `(unwired-capture-${n++})` }),
    ocr: async () => [],
    click: async () => {},
    type: async () => {},
    ground: async (target) => ({
      found: false,
      confidence: 0,
      via: "none",
      note: `native vision plane not wired for "${target.value}" (live-Mac only)`,
    }),
  };
}
