import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("review and memory lane modules explain the lane strategy in prose", () => {
  const report = read("src/lib/managerbee/report.ts");
  const heartbeat = read("src/lib/managerbee/heartbeat.ts");
  const curate = read("src/lib/brainbee/curate.ts");
  const poller = read("src/lib/brainbee/poller.ts");
  const directives = read("src/lib/orchestrator/directive-store.ts");

  assert.match(report, /Review Lane — the control-plane heartbeat \+ diagnostics surface/);
  assert.match(report, /Review Lane does not run work/);
  assert.doesNotMatch(report, /ManagerBee — the control-plane heartbeat|ManagerBee does not run work/);

  assert.match(heartbeat, /Review Lane heartbeat/);
  assert.match(heartbeat, /Message Lane\/Mail Lane pollers/);
  assert.doesNotMatch(heartbeat, /ManagerBee heartbeat|MessageBee\/MailBee pollers/);

  assert.match(curate, /Memory Lane — playbook hygiene/);
  assert.match(curate, /Memory Lane curates/);
  assert.doesNotMatch(curate, /BrainBee — playbook hygiene|BrainBee curates/);

  assert.match(poller, /Memory Lane poller/);
  assert.match(poller, /Mail Lane poller/);
  assert.doesNotMatch(poller, /BrainBee poller|MailBee poller/);

  assert.match(directives, /used by Review Lane for the control-plane report/);
  assert.doesNotMatch(directives, /used by ManagerBee for the control-plane report/);
});
