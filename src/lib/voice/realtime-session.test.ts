import test from "node:test";
import assert from "node:assert/strict";
import { parseTurnConfig } from "./realtime-session";

test("parseTurnConfig always includes a STUN server", () => {
  const s = parseTurnConfig({});
  assert.equal(s.length, 1);
  assert.match(s[0].urls as string, /^stun:/);
});

test("parseTurnConfig appends TURN with credentials when configured", () => {
  const s = parseTurnConfig({
    turn: { urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" },
  });
  assert.equal(s.length, 2);
  assert.deepEqual(s[1], { urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" });
});

test("parseTurnConfig accepts a string url and omits absent creds", () => {
  const s = parseTurnConfig({ turn: { urls: "turn:t.example.com:3478" } });
  assert.deepEqual(s[1], { urls: ["turn:t.example.com:3478"] });
});

test("parseTurnConfig ignores a malformed/empty turn block", () => {
  assert.equal(parseTurnConfig({ turn: {} }).length, 1);
  assert.equal(parseTurnConfig({ turn: { urls: [] } }).length, 1);
  assert.equal(parseTurnConfig({ turn: "nope" }).length, 1);
});
