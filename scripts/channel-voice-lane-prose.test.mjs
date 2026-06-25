import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("channel and voice prose uses lane names", () => {
  const decisions = read("DECISIONS.md");
  const feedback = read("src/lib/feedback/feedback.ts");
  const tts = read("src/lib/voice/tts.ts");
  const voiceSession = read("src/lib/voice/session.ts");
  const daemonIndex = read("src/daemon/index.ts");

  assert.match(decisions, /## Mail Lane: agent reached for Gmail MCP instead of Apple Mail/);
  assert.match(decisions, /Mail Lane = Apple Mail/);
  assert.match(decisions, /Mail Lane attachment path could not attach files/);
  assert.match(decisions, /## Q12 — Voice Lane un-deferred/);
  assert.match(decisions, /Decision A — Voice Lane un-deferred/);
  assert.match(decisions, /mirrors the Q8\/Q9 Message Lane\/Mail Lane un-defer/);
  assert.match(decisions, /extends the Q9 Mail Lane attachment pattern to Message Lane/);
  assert.match(decisions, /Voice Lane\s+listed as a Q12 lane/);
  assert.doesNotMatch(decisions, /## MailBee:|MailBee = Apple Mail|MailBee couldn't|## Q12 — VoiceBee|Decision A — VoiceBee|MessageBee\/MailBee un-defer|MessageBee `send file`|VoiceBee hard-fail|VoiceBee listed|`VoiceBee` string/);

  assert.match(feedback, /a text to\s+\*\s+Message Lane/);
  assert.doesNotMatch(feedback, /a text to MessageBee/);

  assert.match(tts, /DECISIONS Q12 \/ Voice Lane/);
  assert.match(tts, /whether a Message Lane result is sent back/);
  assert.doesNotMatch(tts, /VoiceBee|MessageBee result/);

  assert.match(voiceSession, /Voice Lane session contract/);
  assert.match(voiceSession, /prior Voice Lane design/);
  assert.doesNotMatch(voiceSession, /VoiceBee/);

  assert.match(daemonIndex, /Market Insight Lane: watch market data/);
  assert.doesNotMatch(daemonIndex, /TraderBee: watch market data/);
});
