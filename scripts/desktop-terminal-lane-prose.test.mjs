import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop source prose uses lane names around compatibility APIs", () => {
  const actions = read("src/lib/desktopbee/actions.ts");
  const client = read("src/lib/desktopbee/client.ts");
  const workflow = read("src/lib/desktopbee/workflow.ts");
  const vision = read("src/lib/desktopbee/vision.ts");
  const contracts = read("src/lib/desktopbee/contracts.ts");
  const token = read("src/lib/auth/token.ts");
  const security = read("docs/SECURITY-REVIEW.md");

  assert.match(actions, /Desktop Lane action contract/);
  assert.match(client, /HiveMatrix-side Desktop Lane client/);
  assert.match(client, /Dispatch a Desktop Lane action/);
  assert.match(workflow, /Desktop Lane proof-workflow runner/);
  assert.match(vision, /Desktop Lane vision plane/);
  assert.match(contracts, /Desktop Lane compatibility contracts/);
  assert.doesNotMatch(actions, /DesktopBee action contract/);
  assert.doesNotMatch(client, /HiveMatrix-side DesktopBee client|Dispatches DesktopBee actions|Dispatch a DesktopBee action/);
  assert.doesNotMatch(workflow, /DesktopBee proof-workflow runner|DesktopBee actions/);
  assert.doesNotMatch(vision, /DesktopBee vision plane/);
  assert.doesNotMatch(contracts, /DesktopBee \(formerly ComputerBee/);

  assert.match(token, /Desktop Lane helper/);
  assert.match(security, /Desktop Lane helper API is unauthenticated/);
  assert.match(security, /Desktop Lane proof and soak still green/);
  assert.doesNotMatch(token, /DesktopBee helper/);
  assert.doesNotMatch(security, /DesktopBee helper API is unauthenticated|DesktopBee proof and soak/);
});
