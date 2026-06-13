import assert from "node:assert/strict";
import test from "node:test";

import { deliverTrustedMailBeeReply, type MailBeeDeliveryTask } from "./delivery";

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
