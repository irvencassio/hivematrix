import assert from "node:assert/strict";
import test from "node:test";

import type { LaneWorkerStatus } from "@/lib/lanes/service-manager";
import { shapeLaneServiceStatuses } from "./status";

function status(overrides: Partial<LaneWorkerStatus> & Pick<LaneWorkerStatus, "kind" | "name">): LaneWorkerStatus {
  return {
    kind: overrides.kind,
    name: overrides.name,
    role: overrides.role ?? "capability",
    phase: overrides.phase ?? 1,
    summary: overrides.summary ?? "",
    runtimeMode: overrides.runtimeMode ?? "embedded",
    manageable: overrides.manageable ?? false,
    available: overrides.available ?? true,
    autoStart: overrides.autoStart ?? true,
    running: overrides.running ?? true,
    loaded: overrides.loaded ?? true,
    healthy: overrides.healthy ?? true,
    pid: overrides.pid ?? null,
    repoPath: overrides.repoPath ?? null,
    plistLabel: overrides.plistLabel ?? null,
    plistPath: overrides.plistPath ?? null,
    healthcheckUrl: overrides.healthcheckUrl ?? null,
    statusDetail: overrides.statusDetail ?? null,
  };
}

test("lane statuses collapse browser read and workflow capabilities into one Browser Lane", () => {
  const lanes = shapeLaneServiceStatuses([
    status({ kind: "webbee", name: "Browser Lane Read", summary: "read/search", healthy: true }),
    status({ kind: "browserbee", name: "Browser Lane Workflow", summary: "workflow", healthy: false, statusDetail: "needs auth" }),
    status({ kind: "desktopbee", name: "DesktopBee", summary: "desktop" }),
  ]);

  assert.deepEqual(lanes.map((lane) => lane.kind), ["browser", "desktop"]);
  assert.equal(lanes[0].name, "Browser Lane");
  assert.equal(lanes[0].healthy, false);
  assert.match(lanes[0].summary, /read\/search/);
  assert.match(lanes[0].summary, /workflow/);
  assert.match(lanes[0].statusDetail ?? "", /needs auth/);
});

test("lane statuses expose clear lane names instead of bee product names", () => {
  const lanes = shapeLaneServiceStatuses([
    status({ kind: "mailbee", name: "MailBee" }),
    status({ kind: "messagebee", name: "MessageBee" }),
    status({ kind: "desktopbee", name: "DesktopBee" }),
    status({ kind: "brainbee", name: "BrainBee" }),
    status({ kind: "managerbee", name: "ManagerBee" }),
  ]);

  assert.deepEqual(lanes.map((lane) => [lane.kind, lane.name]), [
    ["mail", "Mail Lane"],
    ["message", "Message Lane"],
    ["desktop", "Desktop Lane"],
    ["memory", "Memory Lane"],
    ["review", "Review Lane"],
  ]);
});
