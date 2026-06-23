import test from "node:test";
import assert from "node:assert/strict";
import { summarizeByKind, normalizeKind } from "./yt-ledger.mjs";
import { tokenCoversScopes, SCOPE_UPLOAD, SCOPE_READONLY } from "./yt-auth.mjs";

test("normalizeKind coerces unknown/blank to faceless, keeps known", () => {
  assert.equal(normalizeKind("presenter"), "presenter");
  assert.equal(normalizeKind("SCREEN"), "screen");
  assert.equal(normalizeKind("avatar"), "avatar");
  assert.equal(normalizeKind("agent-avatar"), "agent-avatar");
  assert.equal(normalizeKind("nonsense"), "faceless");
  assert.equal(normalizeKind(""), "faceless");
  assert.equal(normalizeKind(undefined), "faceless");
});

test("summarizeByKind groups, averages, sorts by avgViews desc", () => {
  const rows = summarizeByKind([
    { kind: "presenter", stats: { views: 1000, likes: 100, comments: 10 } },
    { kind: "presenter", stats: { views: 2000, likes: 100, comments: 30 } },
    { kind: "faceless", stats: { views: 100, likes: 2, comments: 0 } },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "presenter"); // higher avgViews sorts first
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].avgViews, 1500);
  assert.equal(rows[0].avgLikes, 100);
  assert.equal(rows[0].avgComments, 20);
  assert.equal(rows[0].likeRate, 6.67);   // 200 likes / 3000 views * 100
  assert.equal(rows[1].kind, "faceless");
  assert.equal(rows[1].avgViews, 100);
});

test("summarizeByKind tolerates missing/zero stats without dividing by zero", () => {
  const rows = summarizeByKind([{ kind: "avatar", stats: { views: 0, likes: 0, comments: 0 } }]);
  assert.equal(rows[0].likeRate, 0);
  assert.equal(rows[0].commentRate, 0);
  assert.equal(rows[0].avgViews, 0);
});

test("unknown kinds fold into faceless in the rollup", () => {
  const rows = summarizeByKind([{ kind: "weird", stats: { views: 50, likes: 1, comments: 0 } }]);
  assert.equal(rows[0].kind, "faceless");
});

test("tokenCoversScopes is true only when every required scope is granted", () => {
  const token = { scope: `${SCOPE_UPLOAD} ${SCOPE_READONLY}` };
  assert.equal(tokenCoversScopes(token, [SCOPE_UPLOAD]), true);
  assert.equal(tokenCoversScopes(token, [SCOPE_UPLOAD, SCOPE_READONLY]), true);
  assert.equal(tokenCoversScopes({ scope: SCOPE_UPLOAD }, [SCOPE_READONLY]), false);
  assert.equal(tokenCoversScopes({}, [SCOPE_UPLOAD]), false);
});
