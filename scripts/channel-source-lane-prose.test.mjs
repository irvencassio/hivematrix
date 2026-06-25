import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("channel source comments use Message Lane and Mail Lane prose", () => {
  const files = {
    messageStore: read("src/lib/messagebee/store.ts"),
    messageHandoff: read("src/lib/messagebee/handoff.ts"),
    messageIo: read("src/lib/messagebee/imessage.ts"),
    messagePoller: read("src/lib/messagebee/poller.ts"),
    messageContracts: read("src/lib/messagebee/contracts.ts"),
    messageIoTest: read("src/lib/messagebee/imessage.test.ts"),
    mailStore: read("src/lib/mailbee/store.ts"),
    mailDelivery: read("src/lib/mailbee/delivery.ts"),
    mailIo: read("src/lib/mailbee/applemail.ts"),
    mailContracts: read("src/lib/mailbee/contracts.ts"),
    mailPoller: read("src/lib/mailbee/poller.ts"),
  };

  assert.match(files.messageStore, /Message Lane state over the v5 messaging tables/);
  assert.match(files.messageHandoff, /Message Lane routing/);
  assert.match(files.messageIo, /Message Lane I\/O against macOS Messages/);
  assert.match(files.messagePoller, /Message Lane poller/);
  assert.match(files.messageContracts, /Message Lane contracts/);
  assert.doesNotMatch(files.messageStore, /MessageBee state/);
  assert.doesNotMatch(files.messageHandoff, /MessageBee routing/);
  assert.doesNotMatch(files.messageIo, /MessageBee I\/O|MessageBee replies silently/);
  assert.doesNotMatch(files.messagePoller, /MessageBee poller/);
  assert.doesNotMatch(files.messageContracts, /MessageBee contracts/);
  assert.doesNotMatch(files.messageIoTest, /MessageBee replies silently/);

  assert.match(files.mailStore, /Mail Lane state over the v5 messaging tables/);
  assert.match(files.mailStore, /Message Lane store/);
  assert.match(files.mailDelivery, /headless Mail Lane agent/);
  assert.match(files.mailDelivery, /Mail Lane send path/);
  assert.match(files.mailIo, /Mail Lane I\/O against Apple Mail/);
  assert.match(files.mailContracts, /Mail Lane contracts/);
  assert.match(files.mailPoller, /Mail Lane poller/);
  assert.doesNotMatch(files.mailStore, /MailBee state|MessageBee store/);
  assert.doesNotMatch(files.mailDelivery, /headless MailBee agent|MailBee send path/);
  assert.doesNotMatch(files.mailIo, /MailBee I\/O/);
  assert.doesNotMatch(files.mailContracts, /MailBee contracts/);
  assert.doesNotMatch(files.mailPoller, /MailBee poller/);
});
