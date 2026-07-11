import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldSkipRatchet,
  buildRatchetPrompt,
  deterministicRatchetFallback,
  parseRatchetModelReply,
  buildRatchetProposal,
  runRatchetPass,
  type RatchetEscalation,
  type RatchetDeps,
} from "./ratchet";

const NOW = new Date("2026-07-10T18:00:00");

function fakeDeps(over: Partial<RatchetDeps> = {}): RatchetDeps {
  return {
    listVoiceEscalations: async () => [],
    chatComplete: async () => "",
    createTask: async () => ({ _id: "task-1" }),
    now: () => NOW,
    ...over,
  };
}

const esc = (title: string, description = ""): RatchetEscalation => ({ title, description });

// ---------------------------------------------------------------------------
// Pure decision + prompt-building pieces
// ---------------------------------------------------------------------------

test("shouldSkipRatchet: true only for zero escalations", () => {
  assert.equal(shouldSkipRatchet([]), true);
  assert.equal(shouldSkipRatchet([esc("Book a flight")]), false);
});

test("buildRatchetPrompt: instructs the structured Tool:/analysis format and lists escalations", () => {
  const { system, user } = buildRatchetPrompt([esc("Book a flight", "to Denver"), esc("Order flowers")]);
  assert.match(system, /Tool:\s*<short tool name/);
  assert.match(system, /exactly 3 sentences/);
  assert.match(user, /1\. Book a flight — to Denver/);
  assert.match(user, /2\. Order flowers/);
});

test("deterministicRatchetFallback: lists at most the top 3 most recent titles", () => {
  const fallback = deterministicRatchetFallback([esc("A"), esc("B"), esc("C"), esc("D")]);
  assert.match(fallback, /- A/);
  assert.match(fallback, /- B/);
  assert.match(fallback, /- C/);
  assert.doesNotMatch(fallback, /- D/);
});

test("parseRatchetModelReply: parses the structured format, strips think-blocks", () => {
  const parsed = parseRatchetModelReply("<think>hmm</think>Tool: Flight Booking Assistant\nIt would book flights. It would confirm seats. It would email itineraries.");
  assert.deepEqual(parsed, {
    tool: "Flight Booking Assistant",
    analysis: "It would book flights. It would confirm seats. It would email itineraries.",
  });
});

test("parseRatchetModelReply: null when the model didn't follow the format", () => {
  assert.equal(parseRatchetModelReply("I think you should build a flight booking tool."), null);
  assert.equal(parseRatchetModelReply(""), null);
  assert.equal(parseRatchetModelReply("Tool: \n"), null); // empty tool name
});

test("buildRatchetProposal: parsed case names the tool in the task title and a 2-line notify", () => {
  const proposal = buildRatchetProposal(4, { tool: "Flight Booking Assistant", analysis: "3 sentences here." }, "fallback text");
  assert.equal(proposal.taskTitle, "Ratchet: build Flight Booking Assistant");
  assert.equal(proposal.taskDescription, "3 sentences here.");
  assert.equal(proposal.notifyText.split("\n").length, 2);
  assert.match(proposal.notifyText, /4 times/);
  assert.match(proposal.notifyText, /Flight Booking Assistant/);
});

test("buildRatchetProposal: singular count reads '1 time', not '1 times'", () => {
  const proposal = buildRatchetProposal(1, { tool: "X", analysis: "y" }, "fallback");
  assert.match(proposal.notifyText, /1 time this week/);
});

test("buildRatchetProposal: fallback case uses the generic title + deterministic text, still a 2-line notify", () => {
  const proposal = buildRatchetProposal(2, null, "Model clustering was unavailable this week.\n- A\n- B");
  assert.equal(proposal.taskTitle, "Ratchet: review this week's voice escalations");
  assert.match(proposal.taskDescription, /Model clustering was unavailable/);
  assert.equal(proposal.notifyText.split("\n").length, 2);
  assert.match(proposal.notifyText, /2 times/);
});

// ---------------------------------------------------------------------------
// runRatchetPass — the one non-pure entry point
// ---------------------------------------------------------------------------

test("runRatchetPass: zero escalations is a complete no-op — no model call, no task created", async () => {
  let chatCalled = false;
  let createCalled = false;
  const result = await runRatchetPass(fakeDeps({
    listVoiceEscalations: async () => [],
    chatComplete: async () => { chatCalled = true; return "Tool: X\nanalysis"; },
    createTask: async () => { createCalled = true; return { _id: "t" }; },
  }));
  assert.deepEqual(result, { created: false, notifyText: null });
  assert.equal(chatCalled, false);
  assert.equal(createCalled, false);
});

test("runRatchetPass: successful clustering creates the named task and returns its notify text", async () => {
  const createdPayloads: { title: string; description: string }[] = [];
  const result = await runRatchetPass(fakeDeps({
    listVoiceEscalations: async () => [esc("Book a flight"), esc("Order flowers"), esc("Pay rent"), esc("Call the vet")],
    chatComplete: async () => "Tool: Flight Booking Assistant\nIt books flights. It confirms seats. It emails itineraries.",
    createTask: async (payload) => { createdPayloads.push(payload); return { _id: "task-42" }; },
  }));
  assert.equal(result.created, true);
  assert.equal(result.taskId, "task-42");
  assert.match(result.notifyText ?? "", /4 times/);
  assert.match(result.notifyText ?? "", /Flight Booking Assistant/);
  assert.equal(createdPayloads[0].title, "Ratchet: build Flight Booking Assistant");
  assert.match(createdPayloads[0].description, /It books flights/);
});

test("runRatchetPass: model failure still creates a task, using the deterministic fallback", async () => {
  const createdPayloads: { title: string; description: string }[] = [];
  const result = await runRatchetPass(fakeDeps({
    listVoiceEscalations: async () => [esc("Book a flight")],
    chatComplete: async () => { throw new Error("model down"); },
    createTask: async (payload) => { createdPayloads.push(payload); return { _id: "task-7" }; },
  }));
  assert.equal(result.created, true);
  assert.equal(createdPayloads[0].title, "Ratchet: review this week's voice escalations");
  assert.match(createdPayloads[0].description, /Book a flight/);
  assert.match(result.notifyText ?? "", /Clustering failed/);
});

test("runRatchetPass: an unparseable model reply also falls back deterministically", async () => {
  const result = await runRatchetPass(fakeDeps({
    listVoiceEscalations: async () => [esc("Book a flight")],
    chatComplete: async () => "I'm not sure what tool would help here.",
  }));
  assert.equal(result.created, true);
  assert.match(result.notifyText ?? "", /Clustering failed/);
});
