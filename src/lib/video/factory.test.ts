import test from "node:test";
import assert from "node:assert/strict";
import { buildMakeArgs } from "./factory";
import { videoRoutingPrompt } from "@/lib/orchestrator/outbound-routing";

test("buildMakeArgs — topic mode threads flags after the output path", () => {
  assert.deepEqual(
    buildMakeArgs({ topic: "why local AI", out: "/tmp/o.mp4", lang: "it", title: "T", seconds: 30 }),
    ["make.mjs", "/tmp/o.mp4", "--topic", "why local AI", "--seconds", "30", "--lang", "it", "--title", "T"],
  );
});

test("buildMakeArgs — script mode keeps script then out, adds screen", () => {
  assert.deepEqual(
    buildMakeArgs({ scriptFile: "/tmp/s.txt", out: "/tmp/o.mp4", screen: "/tmp/rec.mp4" }),
    ["make.mjs", "/tmp/s.txt", "/tmp/o.mp4", "--screen", "/tmp/rec.mp4"],
  );
});

test("buildMakeArgs — presenter clip is appended as --presenter", () => {
  assert.deepEqual(
    buildMakeArgs({ scriptFile: "/tmp/s.txt", out: "/tmp/o.mp4", music: "/tmp/m.mp3", presenter: "/tmp/cam.mp4" }),
    ["make.mjs", "/tmp/s.txt", "/tmp/o.mp4", "--music", "/tmp/m.mp3", "--presenter", "/tmp/cam.mp4"],
  );
});

test("videoRoutingPrompt points the agent at the local /video/make endpoint", () => {
  const p = videoRoutingPrompt();
  assert.match(p, /\/video\/make/);
  assert.match(p, /"topic"/);
  assert.match(p, /do NOT try to render video yourself/);
});
