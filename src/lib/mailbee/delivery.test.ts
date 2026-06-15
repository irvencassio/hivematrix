import assert from "node:assert/strict";
import test from "node:test";

import { deliverTrustedMailBeeReply, looksLikeAuthRequest, type MailBeeDeliveryTask } from "./delivery";

const trustedTask = (over: Partial<MailBeeDeliveryTask> = {}): MailBeeDeliveryTask => ({
  _id: "task1",
  source: "mailbee",
  output: {
    summary: "Here is the answer.",
    mailbee: {
      from: "cassio.irv@gmail.com",
      subject: "test",
      trust: "trusted",
      autoSendEligible: true,
    },
  },
  ...over,
});

test("trusted MailBee completion sends final answer and records delivery", async () => {
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  const result = await deliverTrustedMailBeeReply(trustedTask(), {
    sendMail: async (to, subject, body) => {
      sent.push({ to, subject, body });
      return true;
    },
    now: () => "2026-06-13T18:30:00.000Z",
  });

  assert.equal(result.sent, true);
  assert.deepEqual(sent, [{
    to: "cassio.irv@gmail.com",
    subject: "Re: test",
    body: "Here is the answer.",
  }]);
  const mailbee = result.output.mailbee as Record<string, unknown>;
  assert.equal(mailbee.sentAt, "2026-06-13T18:30:00.000Z");
  assert.equal(mailbee.delivery, "sent");
});

test("trusted MailBee completion does not send when the agent needs input", async () => {
  let calls = 0;
  const result = await deliverTrustedMailBeeReply(trustedTask(), {
    reviewState: "needs_input",
    sendMail: async () => { calls += 1; return true; },
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "needs_input");
  assert.equal(calls, 0);
});

test("non-trusted MailBee completion does not send", async () => {
  let calls = 0;
  const result = await deliverTrustedMailBeeReply(trustedTask({
    output: {
      summary: "Draft only.",
      mailbee: {
        from: "person@example.com",
        subject: "hi",
        trust: "external",
        autoSendEligible: false,
      },
    },
  }), {
    sendMail: async () => { calls += 1; return true; },
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "not_auto_send_eligible");
  assert.equal(calls, 0);
});

test("trusted reply asking the sender to authenticate Gmail/MCP is held, not sent", async () => {
  // The exact failure: the agent improvised "run /mcp to authenticate Gmail"
  // instead of attaching the files through MailBee. Auto-emailing that is worse
  // than not replying — hold it for human review.
  let calls = 0;
  const result = await deliverTrustedMailBeeReply(trustedTask({
    output: {
      summary: "To send your wallpaper images, I need Gmail access. Please run `/mcp` in Claude Code and select \"claude.ai Gmail\" to authenticate.",
      mailbee: {
        from: "cassio.irv@gmail.com", subject: "wallpaper", trust: "trusted", autoSendEligible: true,
      },
    },
  }), {
    sendMail: async () => { calls += 1; return true; },
    now: () => "2026-06-15T20:28:59.000Z",
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "held_auth_request");
  assert.equal(calls, 0, "must not email the sender a dead-end auth request");
  const mailbee = result.output.mailbee as Record<string, unknown>;
  assert.equal(mailbee.delivery, "held_auth_request");
  assert.equal(mailbee.sentAt, undefined);
});

test("looksLikeAuthRequest flags auth dead-ends but not ordinary replies", () => {
  assert.equal(looksLikeAuthRequest("I need Gmail access. Please run /mcp to authenticate."), true);
  assert.equal(looksLikeAuthRequest("Authenticate the claude.ai Gmail connector first."), true);
  assert.equal(looksLikeAuthRequest("Run /login and authorize Google."), true);
  // Ordinary replies — including ones that merely mention email or files — pass.
  assert.equal(looksLikeAuthRequest("I've attached all 7 wallpaper images. Let me know if you need other sizes."), false);
  assert.equal(looksLikeAuthRequest("Here is the Q3 summary you asked for."), false);
});

test("trusted MailBee completion does not send twice", async () => {
  let calls = 0;
  const result = await deliverTrustedMailBeeReply(trustedTask({
    output: {
      summary: "Already sent.",
      mailbee: {
        from: "cassio.irv@gmail.com",
        subject: "test",
        trust: "trusted",
        autoSendEligible: true,
        sentAt: "2026-06-13T18:00:00.000Z",
      },
    },
  }), {
    sendMail: async () => { calls += 1; return true; },
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "already_sent");
  assert.equal(calls, 0);
});
