import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VisionSeams, OcrBox } from "./vision";

const TMP = mkdtempSync(join(tmpdir(), "hm-vision-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  groundViaOcr,
  verifyExpectation,
  runVisionFlow,
  unavailableVisionSeams,
} = await import("./vision");
const { writeVisionTrace } = await import("./trace");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("groundViaOcr returns the center of the matching OCR box", () => {
  const boxes: OcrBox[] = [
    { text: "Cancel", x: 0, y: 0, w: 80, h: 20 },
    { text: "Log In", x: 100, y: 200, w: 60, h: 20 },
  ];
  const hit = groundViaOcr({ kind: "text", value: "Log In" }, boxes);
  assert.equal(hit.found, true);
  assert.equal(hit.via, "ocr");
  assert.equal(hit.x, 130);
  assert.equal(hit.y, 210);

  const miss = groundViaOcr({ kind: "text", value: "Submit" }, boxes);
  assert.equal(miss.found, false);
  assert.equal(miss.via, "none");
});

test("verifyExpectation checks text presence/absence in the post-action frame", () => {
  const boxes: OcrBox[] = [{ text: "Welcome back", x: 0, y: 0, w: 10, h: 10 }];
  assert.equal(verifyExpectation({ kind: "text_present", value: "Welcome" }, boxes), true);
  assert.equal(verifyExpectation({ kind: "text_absent", value: "Welcome" }, boxes), false);
  assert.equal(verifyExpectation({ kind: "text_absent", value: "Error" }, boxes), true);
});

test("runVisionFlow grounds via OCR, clicks the center, and verifies the postcondition", async () => {
  // Frame 1 shows "Log In"; after the click, frame 2 shows "Welcome".
  const frames: OcrBox[][] = [
    [{ text: "Log In", x: 100, y: 200, w: 60, h: 20 }],
    [{ text: "Welcome back", x: 0, y: 0, w: 100, h: 20 }],
  ];
  let frameIdx = 0;
  const clicks: Array<[number, number]> = [];
  const seams: VisionSeams = {
    capture: async () => ({ capturePath: `frame-${frameIdx}.png` }),
    ocr: async () => frames[Math.min(frameIdx++, frames.length - 1)],
    click: async (x, y) => { clicks.push([x, y]); },
    type: async () => {},
  };

  const result = await runVisionFlow(
    [{ target: { kind: "text", value: "Log In" }, action: "click", expect: { kind: "text_present", value: "Welcome" } }],
    seams,
  );

  assert.equal(result.ok, true);
  assert.equal(result.steps[0].verdict, "verified");
  assert.equal(result.steps[0].grounding.via, "ocr");
  assert.deepEqual(clicks, [[130, 210]]);
});

test("a step whose target is not on screen fails without acting", async () => {
  const seams: VisionSeams = {
    capture: async () => ({ capturePath: "f.png" }),
    ocr: async () => [{ text: "Cancel", x: 0, y: 0, w: 10, h: 10 }],
    click: async () => { throw new Error("must not click when ungrounded"); },
    type: async () => {},
  };
  const result = await runVisionFlow([{ target: { kind: "text", value: "Log In" }, action: "click" }], seams);
  assert.equal(result.ok, false);
  assert.equal(result.steps[0].verdict, "failed");
});

test("default seams report not-wired rather than pretending (live-Mac deferral)", async () => {
  const result = await runVisionFlow(
    [{ target: { kind: "describe", value: "the Citrix Receiver icon" }, action: "click" }],
    unavailableVisionSeams(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.steps[0].verdict, "failed");
  assert.match(result.steps[0].grounding.note, /not wired/);
});

test("writeVisionTrace stages the action trace as a task artifact", () => {
  const result = {
    ok: true,
    steps: [
      {
        index: 0,
        target: { kind: "text" as const, value: "Log In" },
        action: "click" as const,
        grounding: { found: true, x: 130, y: 210, confidence: 1, via: "ocr" as const, note: "ok" },
        beforeCapture: "f0.png",
        afterCapture: "f1.png",
        verdict: "verified" as const,
        note: "ok",
      },
    ],
  };
  const out = writeVisionTrace("task_vision_1", "citrix-login", result, "s1");
  assert.equal(out.ok, true);
  assert.equal(out.verified, 1);
  assert.equal(out.total, 1);
  assert.ok(existsSync(out.path));
  const written = JSON.parse(readFileSync(out.path, "utf-8"));
  assert.equal(written.flow, "citrix-login");
  assert.equal(written.steps[0].grounding.via, "ocr");
});
