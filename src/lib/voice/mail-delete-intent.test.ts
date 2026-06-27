import test from "node:test";
import assert from "node:assert/strict";
import { detectVoiceMailDeleteIntent } from "./mail-delete-intent";

test("detects explicit email delete requests for review", () => {
  assert.deepEqual(detectVoiceMailDeleteIntent("delete the latest email from Stripe"), {
    query: "latest email from Stripe",
    destructive: true,
  });
  assert.deepEqual(detectVoiceMailDeleteIntent("trash the newsletter from Acme"), {
    query: "newsletter from Acme",
    destructive: true,
  });
  assert.deepEqual(detectVoiceMailDeleteIntent("delete the calendar invite from vendor"), {
    query: "calendar invite from vendor",
    destructive: true,
  });
});

test("does not treat unrelated delete requests as email deletion", () => {
  assert.equal(detectVoiceMailDeleteIntent("delete the temp file"), null);
  assert.equal(detectVoiceMailDeleteIntent("remove the task from my board"), null);
});
