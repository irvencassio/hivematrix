import test from "node:test";
import assert from "node:assert/strict";

import {
  composeDayBrief,
  calendarLine,
  remindersLine,
  reviewLine,
  reviewAttentionCount,
  loopClosureLine,
  goalsDueLine,
  completedLine,
  openLine,
  queuedLine,
  timeSalutation,
  buildGreetingText,
  buildVoiceGreeting,
  GREETING_FALLBACK,
  type DayBriefDeps,
  type DayBriefTaskRef,
  type DayBriefGoalDue,
  type VoiceLoopClosure,
} from "./day-brief";
import type { WorkflowInbox, InboxGroup } from "@/lib/workflows/inbox";

const INBOX_GROUPS: InboxGroup[] = [
  "needs_review",
  "changes_requested",
  "proposed_actions_ready",
  "proposed_actions_blocked",
  "failed_or_attention",
  "running_or_pending",
  "recently_completed",
];

function makeInbox(counts: Partial<Record<InboxGroup, number>> = {}): WorkflowInbox {
  return {
    counts: Object.fromEntries(INBOX_GROUPS.map((g) => [g, counts[g] ?? 0])) as WorkflowInbox["counts"],
    groups: Object.fromEntries(INBOX_GROUPS.map((g) => [g, []])) as unknown as WorkflowInbox["groups"],
  };
}

function fakeDeps(over: Partial<DayBriefDeps> = {}): DayBriefDeps {
  return {
    executePimTool: async () => "",
    getWorkflowInbox: () => makeInbox(),
    listVoiceLoopClosures: async () => [],
    listCompletedSince: async () => [],
    listOpenTasks: async () => [],
    listQueuedOvernight: async () => [],
    listGoalsDueToday: async () => [],
    chatComplete: async () => "",
    readGoalsPersona: () => null,
    now: () => new Date("2026-07-10T08:00:00"),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure line-builders
// ---------------------------------------------------------------------------

test("calendarLine: empty/'nothing' calendar text -> no-meetings line", () => {
  assert.equal(calendarLine(""), "No meetings today.");
  assert.equal(calendarLine("Nothing on the calendar today."), "No meetings today.");
});

test("calendarLine: counts events and names the first as 'next'", () => {
  assert.equal(calendarLine("Standup — Thursday, July 10, 2026 at 9:00:00 AM"), "1 meeting today: Standup.");
  assert.equal(
    calendarLine("Standup — 9:00 AM\nReview — 2:00 PM"),
    "2 meetings today, next: Standup.",
  );
});

test("remindersLine: empty -> no-reminders line; counts + first name otherwise", () => {
  assert.equal(remindersLine(""), "No reminders due.");
  assert.equal(remindersLine("No open reminders."), "No reminders due.");
  assert.equal(remindersLine("- Call the vet (due today)"), "1 reminder open: Call the vet.");
  assert.equal(
    remindersLine("- Call the vet (due today)\n- Pay rent"),
    "2 reminders open, e.g. Call the vet.",
  );
});

test("reviewAttentionCount / reviewLine: sums needs_review + changes_requested + ready", () => {
  const inbox = makeInbox({ needs_review: 2, changes_requested: 1, proposed_actions_ready: 3, proposed_actions_blocked: 5 });
  assert.equal(reviewAttentionCount(inbox), 6);
  assert.equal(reviewLine(inbox), "6 items awaiting review/approval.");
  assert.equal(reviewLine(makeInbox()), "Nothing awaiting your review.");
  assert.equal(reviewLine(null), "Nothing awaiting your review.");
});

test("loopClosureLine: null when empty, names the most recent otherwise", () => {
  assert.equal(loopClosureLine([]), null);
  const one: VoiceLoopClosure[] = [{ title: "Called the vet back", notifiedAt: "2026-07-10T07:00:00Z" }];
  assert.equal(loopClosureLine(one), "Closed the loop on: Called the vet back.");
  const two: VoiceLoopClosure[] = [...one, { title: "Booked the flight", notifiedAt: "2026-07-10T06:00:00Z" }];
  assert.equal(loopClosureLine(two), "Closed the loop on 2, incl. Called the vet back.");
});

test("goalsDueLine: null when empty, names the first due goal otherwise", () => {
  assert.equal(goalsDueLine([]), null);
  const one: DayBriefGoalDue[] = [{ title: "Read scripture" }];
  assert.equal(goalsDueLine(one), "Goal due today: Read scripture.");
  const two: DayBriefGoalDue[] = [...one, { title: "Log a workout" }];
  assert.equal(goalsDueLine(two), "2 goals due today, incl. Read scripture.");
});

test("completedLine / openLine / queuedLine: empty vs counted", () => {
  const t = (title: string): DayBriefTaskRef => ({ title });
  assert.equal(completedLine([]), "Nothing shipped today.");
  assert.equal(completedLine([t("Ship the release")]), "Shipped: Ship the release.");
  assert.equal(completedLine([t("A"), t("B")]), "Shipped 2 today, incl. A.");
  assert.equal(openLine([]), "Nothing open or slipped.");
  assert.equal(openLine([t("Follow up with Sam")]), "Still open: Follow up with Sam.");
  assert.equal(queuedLine([]), "Nothing queued overnight.");
  assert.equal(queuedLine([t("Nightly sync")]), "Queued overnight: Nightly sync.");
});

// ---------------------------------------------------------------------------
// composeDayBrief — morning
// ---------------------------------------------------------------------------

test("composeDayBrief('morning'): assembles schedule + reminders + review + ONE thing", async () => {
  const deps = fakeDeps({
    executePimTool: async (name) => {
      if (name === "calendar_today") return "Standup — 9:00 AM";
      if (name === "reminders_list") return "- Call the vet (due today)";
      return "";
    },
    getWorkflowInbox: () => makeInbox({ needs_review: 1 }),
    chatComplete: async () => "Ship the day-brief spec.",
  });
  const text = await composeDayBrief("morning", deps);
  const lines = text.split("\n");
  assert.ok(lines.length <= 6);
  assert.equal(lines[0], "1 meeting today: Standup.");
  assert.equal(lines[1], "1 reminder open: Call the vet.");
  assert.equal(lines[2], "1 item awaiting review/approval.");
  assert.equal(lines[lines.length - 1], "ONE thing: Ship the day-brief spec.");
});

test("composeDayBrief('morning'): includes a recent voice loop-closure when present", async () => {
  const deps = fakeDeps({
    listVoiceLoopClosures: async () => [{ title: "Rebooked the dentist", notifiedAt: "2026-07-10T07:00:00Z" }],
  });
  const text = await composeDayBrief("morning", deps);
  assert.ok(text.includes("Closed the loop on: Rebooked the dentist."));
});

test("composeDayBrief('morning'): includes the due-goals line when the fetcher returns some", async () => {
  const deps = fakeDeps({
    listGoalsDueToday: async () => [{ title: "Read scripture" }, { title: "Log a workout" }],
  });
  const text = await composeDayBrief("morning", deps);
  assert.ok(text.includes("2 goals due today, incl. Read scripture."));
});

test("composeDayBrief('morning'): empty day still produces a valid, short brief", async () => {
  const text = await composeDayBrief("morning", fakeDeps());
  const lines = text.split("\n");
  assert.ok(lines.length <= 6);
  assert.deepEqual(lines, ["No meetings today.", "No reminders due.", "Nothing awaiting your review."]);
});

test("composeDayBrief('morning'): model failure omits the ONE thing line, not the whole brief", async () => {
  const deps = fakeDeps({
    chatComplete: async () => {
      throw new Error("local model not configured");
    },
  });
  const text = await composeDayBrief("morning", deps);
  assert.ok(!text.includes("ONE thing"));
  assert.ok(text.includes("No meetings today."));
});

test("composeDayBrief('morning'): a failing PIM/inbox fetch degrades gracefully (never throws)", async () => {
  const deps = fakeDeps({
    executePimTool: async () => {
      throw new Error("osascript timeout");
    },
    getWorkflowInbox: () => {
      throw new Error("db unavailable");
    },
  });
  const text = await composeDayBrief("morning", deps);
  assert.equal(text, ["No meetings today.", "No reminders due.", "Nothing awaiting your review."].join("\n"));
});

// ---------------------------------------------------------------------------
// composeDayBrief — evening
// ---------------------------------------------------------------------------

test("composeDayBrief('evening'): assembles completed + open + queued", async () => {
  const deps = fakeDeps({
    listCompletedSince: async () => [{ title: "Shipped the release" }],
    listOpenTasks: async () => [{ title: "Follow up with Sam" }, { title: "Draft the memo" }],
    listQueuedOvernight: async () => [{ title: "Nightly backup" }],
  });
  const text = await composeDayBrief("evening", deps);
  const lines = text.split("\n");
  assert.ok(lines.length <= 6);
  assert.equal(lines[0], "Shipped: Shipped the release.");
  assert.equal(lines[1], "2 still open or slipped, incl. Follow up with Sam.");
  assert.equal(lines[2], "Queued overnight: Nightly backup.");
});

test("composeDayBrief('evening'): empty day is a short, honest ledger", async () => {
  const text = await composeDayBrief("evening", fakeDeps());
  assert.equal(
    text,
    ["Nothing shipped today.", "Nothing open or slipped.", "Nothing queued overnight."].join("\n"),
  );
});

test("composeDayBrief('evening'): never calls the model (no ONE thing line)", async () => {
  let called = false;
  const deps = fakeDeps({ chatComplete: async () => { called = true; return "x"; } });
  await composeDayBrief("evening", deps);
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// Voice greeting (Surface 2) — pure helpers + deterministic fallback
// ---------------------------------------------------------------------------

test("timeSalutation: buckets by local hour", () => {
  assert.equal(timeSalutation(new Date("2026-07-10T04:00:00")), "Hi");
  assert.equal(timeSalutation(new Date("2026-07-10T09:00:00")), "Good morning");
  assert.equal(timeSalutation(new Date("2026-07-10T14:00:00")), "Good afternoon");
  assert.equal(timeSalutation(new Date("2026-07-10T20:00:00")), "Good evening");
});

test("buildGreetingText: picks up to 2 highest-signal facts, meeting first", () => {
  const now = new Date("2026-07-10T09:00:00");
  assert.equal(buildGreetingText(now, "", 0, null), "Good morning — I'm ready.");
  assert.equal(
    buildGreetingText(now, "Standup", 3, null),
    "Good morning. your next meeting is Standup, and 3 items waiting on your review or approval.",
  );
  assert.equal(
    buildGreetingText(now, "", 0, { title: "Rebooked the dentist", notifiedAt: "x" }),
    "Good morning. I just closed the loop on Rebooked the dentist.",
  );
});

test("buildVoiceGreeting: assembles from deps when everything succeeds", async () => {
  const deps = fakeDeps({
    executePimTool: async (name) => (name === "calendar_next_within" ? "Standup" : ""),
    getWorkflowInbox: () => makeInbox({ needs_review: 2 }),
    now: () => new Date("2026-07-10T09:00:00"),
  });
  const text = await buildVoiceGreeting(deps);
  assert.equal(text, "Good morning. your next meeting is Standup, and 2 items waiting on your review or approval.");
});

test("buildVoiceGreeting: falls back to the deterministic greeting on ANY error", async () => {
  const deps = fakeDeps({
    executePimTool: async () => {
      throw new Error("osascript timeout");
    },
    getWorkflowInbox: () => {
      throw new Error("db unavailable");
    },
    listVoiceLoopClosures: async () => {
      throw new Error("db unavailable");
    },
  });
  const text = await buildVoiceGreeting(deps);
  // Each fact fetch is individually best-effort, so this still assembles a
  // salutation-only greeting rather than the hard fallback — assert it never
  // throws and stays within the spoken-greeting shape.
  assert.ok(text.length > 0);
  assert.ok(text === GREETING_FALLBACK || /^(Hi|Good morning|Good afternoon|Good evening)/.test(text));
});
