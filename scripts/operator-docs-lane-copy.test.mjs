import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("active operator docs use lane names instead of public bee names", () => {
  const userGuide = read("docs/USER-GUIDE.html");
  const bringup = read("docs/BRINGUP-CHECKLIST.md");
  const release = read("docs/RELEASE.md");
  const drills = read("docs/RUNBOOK-appliance-drills.md");

  assert.match(userGuide, /capability lanes/);
  assert.match(userGuide, /<h2 id="lanes">/);
  assert.match(userGuide, /Desktop Lane/);
  assert.match(userGuide, /Memory Lane/);
  assert.match(userGuide, /Manager Lane/);
  assert.match(bringup, /Message Lane/);
  assert.match(bringup, /Mail Lane/);
  assert.match(release, /Desktop Lane helper/);
  assert.match(drills, /Desktop Lane \+ Terminal Lane/);

  for (const phrase of [
    "<strong>Bees</strong>",
    "The Bees",
    "Bees tab",
    "<th>Bee</th>",
    "<h3>Bees</h3>",
    "Settings → Bees",
    "DesktopBee helper</span>",
    "Models, Bees,",
  ]) {
    assert.doesNotMatch(userGuide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const [path, content, phrases] of [
    ["docs/BRINGUP-CHECKLIST.md", bringup, ["MessageBee", "MailBee", "DesktopBee"]],
    ["docs/RELEASE.md", release, ["DesktopBee helper", "**desktopbee**"]],
    ["docs/RUNBOOK-appliance-drills.md", drills, ["DesktopBee + TermBee"]],
  ]) {
    for (const phrase of phrases) {
      assert.doesNotMatch(
        content,
        new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${path} still contains visible old phrase: ${phrase}`,
      );
    }
  }
});
