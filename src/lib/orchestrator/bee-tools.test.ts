import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import { isBeeTool, availableBeeTools, executeBeeTool, BEE_TOOL_DEFINITIONS } from "./bee-tools";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name).sort();

test("isBeeTool recognizes the three lanes and rejects others", () => {
  assert.equal(isBeeTool("webbee_search"), true);
  assert.equal(isBeeTool("browserbee_run"), true);
  assert.equal(isBeeTool("desktopbee_action"), true);
  assert.equal(isBeeTool("bash"), false);
  assert.equal(isBeeTool("read_file"), false);
});

test("all three bee tools are defined with required schemas", () => {
  assert.equal(BEE_TOOL_DEFINITIONS.length, 3);
  for (const t of BEE_TOOL_DEFINITIONS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.length > 0);
    assert.ok(t.function.description.length > 0);
    assert.ok(t.function.parameters);
  }
});

test("cloud-ok advertises all three lanes", () => {
  assert.deepEqual(names(availableBeeTools(cloud())), ["browserbee_run", "desktopbee_action", "webbee_search"]);
});

test("local-only advertises only DesktopBee (web lanes need internet)", () => {
  assert.deepEqual(names(availableBeeTools(local())), ["desktopbee_action"]);
});

test("offline advertises only DesktopBee", () => {
  assert.deepEqual(names(availableBeeTools(offline())), ["desktopbee_action"]);
});

test("executeBeeTool refuses an unknown bee tool", async () => {
  const out = await executeBeeTool("nopebee", {}, { projectPath: "/tmp", project: "ops", requestedBy: "test" });
  assert.match(out, /Unknown bee tool/);
});

test("executeBeeTool gates webbee_search behind the connectivity capability", async () => {
  // Force local-only on the singleton policy so the capability gate denies WebBee.
  const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
  const policy = getConnectivityPolicy();
  const prev = policy.getState().manualOverride;
  policy.setManualOverride("offline");
  try {
    const out = await executeBeeTool("webbee_search", { query: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" });
    assert.match(out, /unavailable in the current connectivity mode/);
  } finally {
    policy.setManualOverride(prev);
  }
});
