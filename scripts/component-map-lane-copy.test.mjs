import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentMap = readFileSync(new URL("../COMPONENT-MAP.md", import.meta.url), "utf8");

test("component map uses public lane names instead of PascalCase bee brands", () => {
  for (const phrase of [
    "Terminal Lane",
    "Browser Lane",
    "Desktop Lane",
    "Message Lane",
    "Mail Lane",
    "Market Insight Lane",
    "Voice Lane",
    "Review Lane",
    "Memory Lane",
  ]) {
    assert.match(componentMap, new RegExp(phrase));
  }

  assert.match(componentMap, /browserbee/);
  assert.match(componentMap, /webbee/);
  assert.match(componentMap, /desktopbee/);

  assert.doesNotMatch(
    componentMap,
    /\b(AuthBee|BrainBee|BrowserBee|ComputerBee|CronBee|DesktopBee|MailBee|ManagerBee|MessageBee|TermBee|TraderBee|TubeBee|VoiceBee|WebBee)\b/,
  );
});
