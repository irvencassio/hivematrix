import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceBrowserLaneTask,
  detectVoiceBrowserLaneIntent,
} from "./browser-lane-intent";

test("detects explicit Browser Lane search requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("Use browser lane to search Tesla Model S price"), {
    mode: "search",
    query: "Tesla Model S price",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("browser lane search tesla cars"), {
    mode: "search",
    query: "tesla cars",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("search the web for best solo founder CRMs"), {
    mode: "search",
    query: "best solo founder CRMs",
  });
});

test("detects explicit Browser Lane read requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("browser lane read https://example.com pricing"), {
    mode: "read",
    url: "https://example.com",
    query: "pricing",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to read apple developer news"), {
    mode: "search",
    query: "apple developer news",
  });
});

test("detects explicit Browser Lane open requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to open https://google.com"), {
    mode: "open",
    url: "https://google.com",
    objective: "Open https://google.com",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to open TestFlight"), {
    mode: "search",
    query: "TestFlight",
  });
});

test("unrelated voice text does not become Browser Lane work", () => {
  assert.equal(detectVoiceBrowserLaneIntent("search Tesla Model S price"), null);
  assert.equal(detectVoiceBrowserLaneIntent("tell me a joke"), null);
});

test("task builder carries deterministic lane endpoint instructions", () => {
  const task = buildVoiceBrowserLaneTask({
    mode: "search",
    query: "Tesla Model S price",
  }, { titlePrefix: "Voice" });

  assert.equal(task.source, "browser-lane");
  assert.match(task.title, /Voice: Browser Lane search/);
  assert.match(task.description, /\/lane\/browser/);
  assert.match(task.description, /hivematrix_browser/);
  assert.deepEqual(task.output.browserLaneVoice.args, { mode: "search", query: "Tesla Model S price" });
});
