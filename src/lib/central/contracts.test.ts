import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCentralTaskLease,
  computeWorkerHealth,
  createCentralEvent,
  normalizeWorkerTokenEntry,
  parseCentralTaskStatus,
  parseWorkerRegistration,
} from "./contracts";

test("normalizeWorkerTokenEntry upgrades a legacy token to full scopes", () => {
  const token = normalizeWorkerTokenEntry({
    hostname: "worker-a",
    tokenHash: "hash-1",
  });

  assert.ok(token);
  assert.deepEqual(token?.scopes, ["worker:register", "tasks:pull", "tasks:status"]);
  assert.equal(token?.bee, "generic");
  assert.equal(token?.label, "worker-a");
});

test("parseWorkerRegistration normalizes optional bee metadata", () => {
  const registration = parseWorkerRegistration({
    hostname: "mailbee-01",
    label: "MailBee Primary",
    bee: "mailbee",
    runningTasks: 2,
    agentSlots: 6,
    capabilities: ["email-ingress", "draft-send"],
    softwareVersion: "0.3.1+588",
    metadata: { region: "local" },
  });

  assert.equal(registration.hostname, "mailbee-01");
  assert.equal(registration.bee, "mailbee");
  assert.deepEqual(registration.capabilities, ["email-ingress", "draft-send"]);
  assert.equal(registration.softwareVersion, "0.3.1+588");
  assert.deepEqual(registration.metadata, { region: "local" });
});

test("parseWorkerRegistration accepts lane-native kind values and normalizes to the persisted worker kind", () => {
  // Lane-native value in the legacy `bee` field.
  const viaBee = parseWorkerRegistration({
    hostname: "lane-01", label: "Message Lane", bee: "message",
    runningTasks: 0, agentSlots: 1, capabilities: [], softwareVersion: null, metadata: {},
  });
  assert.equal(viaBee.bee, "messagebee");

  // Lane-native value in the new `lane` field, which takes precedence over `bee`.
  const viaLane = parseWorkerRegistration({
    hostname: "lane-02", label: "Mail Lane", lane: "mail",
    runningTasks: 0, agentSlots: 1, capabilities: [], softwareVersion: null, metadata: {},
  });
  assert.equal(viaLane.bee, "mailbee");

  // Legacy persisted kind strings still pass through unchanged.
  const legacy = parseWorkerRegistration({
    hostname: "old-01", label: "Old", bee: "browserbee",
    runningTasks: 0, agentSlots: 1, capabilities: [], softwareVersion: null, metadata: {},
  });
  assert.equal(legacy.bee, "browserbee");

  // An unknown string still falls back to custom (lane aliases don't widen this).
  const unknown = parseWorkerRegistration({
    hostname: "x", label: "x", bee: "not-a-lane",
    runningTasks: 0, agentSlots: 1, capabilities: [], softwareVersion: null, metadata: {},
  });
  assert.equal(unknown.bee, "custom");
});

test("parseCentralTaskStatus accepts refs and worker events", () => {
  const status = parseCentralTaskStatus({
    status: "in_progress",
    workerStatus: "Pulling mailbox threads",
    artifactRefs: [{ artifactId: "art-1", label: "thread-cache" }],
    traceRefs: [{ traceId: "trace-1", kind: "run" }],
    events: [{ type: "mail.sync", message: "Fetched 12 threads", level: "info" }],
  });

  assert.equal(status.status, "in_progress");
  assert.equal(status.workerStatus, "Pulling mailbox threads");
  assert.equal(status.artifactRefs?.[0]?.artifactId, "art-1");
  assert.equal(status.traceRefs?.[0]?.traceId, "trace-1");
  assert.equal(status.events?.[0]?.type, "mail.sync");
});

test("computeWorkerHealth uses online and stale thresholds", () => {
  const now = Date.now();

  assert.equal(computeWorkerHealth(now - 10_000, now), "online");
  assert.equal(computeWorkerHealth(now - 120_000, now), "stale");
  assert.equal(computeWorkerHealth(now - 600_000, now), "offline");
});

test("buildCentralTaskLease preserves bee and refs for workers", () => {
  const lease = buildCentralTaskLease({
    _id: "task-1",
    title: "Investigate inbox backlog",
    description: "Pull unread mail and classify it",
    project: "hive",
    bee: "mailbee",
    artifactRefs: [{ artifactId: "art-1" }],
    traceRefs: [{ traceId: "trace-1" }],
  });

  assert.equal(lease.bee, "mailbee");
  assert.equal(lease.artifactRefs[0]?.artifactId, "art-1");
  assert.equal(lease.traceRefs[0]?.traceId, "trace-1");
});

test("createCentralEvent stamps ids and timestamps", () => {
  const event = createCentralEvent({
    kind: "task.status",
    centralTaskId: "task-1",
    workerHostname: "worker-a",
    message: "Task entered review",
  });

  assert.equal(event.kind, "task.status");
  assert.equal(event.centralTaskId, "task-1");
  assert.equal(event.workerHostname, "worker-a");
  assert.match(event.id, /^[0-9a-f-]{36}$/);
  assert.doesNotThrow(() => new Date(event.createdAt).toISOString());
});
