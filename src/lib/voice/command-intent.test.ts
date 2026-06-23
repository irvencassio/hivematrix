import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCommandIntent,
  boardReply, approvalsReply, resolvedReply, directivesReply,
  createdTaskReply, connectivityReply, setConnectivityReply,
} from "./command-intent";

test("detects board status queries", () => {
  for (const s of ["what's on my board", "board status", "how many tasks are running", "what are you working on", "give me a status report"]) {
    assert.equal(detectCommandIntent(s).kind, "board", s);
  }
});

test("detects approvals query vs approve/deny command", () => {
  assert.equal(detectCommandIntent("anything to approve?").kind, "approvalsList");
  assert.equal(detectCommandIntent("any pending approvals").kind, "approvalsList");
  assert.equal(detectCommandIntent("what needs my approval").kind, "approvalsList");
  assert.equal(detectCommandIntent("approve it").kind, "approve");
  assert.equal(detectCommandIntent("approve the first one").kind, "approve");
  assert.equal(detectCommandIntent("deny that").kind, "deny");
  assert.equal(detectCommandIntent("reject it").kind, "deny");
});

test("detects create-task and extracts the text", () => {
  assert.deepEqual(detectCommandIntent("create a task to email the investors"), { kind: "createTask", taskText: "email the investors" });
  assert.deepEqual(detectCommandIntent("add a task review the Q3 numbers"), { kind: "createTask", taskText: "review the Q3 numbers" });
  assert.deepEqual(detectCommandIntent("remind me to call the bank"), { kind: "createTask", taskText: "call the bank" });
});

test("detects connectivity query and set", () => {
  assert.equal(detectCommandIntent("are we online?").kind, "connectivity");
  assert.equal(detectCommandIntent("connectivity status").kind, "connectivity");
  assert.deepEqual(detectCommandIntent("go offline"), { kind: "setConnectivity", mode: "offline" });
  assert.deepEqual(detectCommandIntent("switch to local only"), { kind: "setConnectivity", mode: "local-only" });
  assert.deepEqual(detectCommandIntent("go back online"), { kind: "setConnectivity", mode: "cloud-ok" });
});

test("detects directives and falls through otherwise", () => {
  assert.equal(detectCommandIntent("what are my directives").kind, "directives");
  assert.equal(detectCommandIntent("tell me a joke").kind, "none");
  assert.equal(detectCommandIntent("").kind, "none");
});

test("board reply summarizes lanes", () => {
  assert.match(boardReply({ backlog: 2, in_progress: 1, review: 1, done: 5, failed: 0 }), /2 queued.*1 in progress.*1 in review.*5 done/);
  assert.match(boardReply({}), /empty/);
});

test("approvals reply guides the next voice action", () => {
  assert.match(approvalsReply([]), /Nothing/);
  assert.match(approvalsReply([{ title: "send email", kind: "tool" }]), /One approval.*send email.*approve it/);
  assert.match(approvalsReply([{ title: "a", kind: "tool" }, { title: "b", kind: "content" }]), /2 approvals/);
});

test("resolved + directive + task + connectivity replies", () => {
  assert.match(resolvedReply("approve", "send email"), /Approved: send email/);
  assert.match(resolvedReply("deny", null), /Denied/);
  assert.match(directivesReply([{ goal: "ship news", status: "active" }]), /1 active directive: ship news/);
  assert.match(directivesReply([]), /no standing directives/);
  assert.match(createdTaskReply("call the bank"), /queued a task: call the bank/);
  assert.match(connectivityReply("offline"), /offline/);
  assert.match(setConnectivityReply("auto"), /automatic/);
});
