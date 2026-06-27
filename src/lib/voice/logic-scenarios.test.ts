import test from "node:test";
import assert from "node:assert/strict";
import { runVoiceLogicScenarios } from "./logic-scenarios";

test("voice logic scenarios pass without audio or live mutations", async () => {
  const result = await runVoiceLogicScenarios();

  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.ok(result.passed >= 50, "full founder/personal diagnostic should cover at least 50 scenarios");
  assert.equal(result.scenarios.length, result.passed);

  const byName = new Map(result.scenarios.map((s) => [s.name, s]));
  assert.equal(byName.get("briefing")?.actual, "command:briefing");
  assert.equal(byName.get("weather")?.actual, "command:weather");
  assert.equal(byName.get("weather saved Kings Mills")?.actual, "command:weather");
  assert.equal(byName.get("browser lane task")?.actual, "command:browserLaneTask");
  assert.equal(byName.get("mail delete review")?.actual, "command:mailDeleteTask");
  assert.equal(byName.get("skill listing")?.actual, "skill:list");
  assert.equal(byName.get("video review read")?.actual, "video:video-read");
  assert.equal(byName.get("generic handoff")?.actual, "handoff:task");

  for (const scenario of result.scenarios) {
    assert.equal(scenario.audioBytes, 0, `${scenario.name} should not synthesize audio`);
    assert.doesNotMatch(scenario.reply, /password|secret|token|cookie/i);
    assert.doesNotMatch(scenario.sideEffects.join("\n"), /password|secret|token|cookie/i);
  }

  assert.ok(
    byName.get("mail delete review")?.sideEffects.some((s) => /simulated task:create/i.test(s)),
    "mail delete review records a simulated task creation",
  );
});
