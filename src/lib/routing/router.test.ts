import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import { routeByRole, isTierAvailable } from "./router";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

test("cloud-ok: think → frontier-premium (Opus), no debt", () => {
  const r = routeByRole("think", cloud());
  assert.equal(r.tier, "frontier-premium");
  assert.equal(r.frontierReviewDebt, false);
});

test("cloud-ok: execute → operational (always cheap)", () => {
  const r = routeByRole("execute", cloud());
  assert.equal(r.tier, "operational");
  assert.equal(r.frontierReviewDebt, false);
});

test("cloud-ok: code-critical → frontier, no debt", () => {
  const r = routeByRole("code-critical", cloud());
  assert.equal(r.tier, "frontier");
  assert.equal(r.frontierReviewDebt, false);
});

test("cloud-ok: image → nanai", () => {
  const r = routeByRole("image", cloud());
  assert.equal(r.tier, "nanai");
});

test("local-only: think → unavailable (no local text inference)", () => {
  const r = routeByRole("think", local());
  assert.equal(r.tier, "unavailable");
});

test("local-only: code-critical → unavailable, no frontier review debt (nothing ran)", () => {
  const r = routeByRole("code-critical", local());
  assert.equal(r.tier, "unavailable");
  assert.equal(r.frontierReviewDebt, false);
});

test("local-only: image → unavailable", () => {
  const r = routeByRole("image", local());
  assert.equal(r.tier, "unavailable");
});

test("offline: execute → unavailable (no local text inference)", () => {
  const r = routeByRole("execute", offline());
  assert.equal(r.tier, "unavailable");
});

test("offline: image → unavailable", () => {
  const r = routeByRole("image", offline());
  assert.equal(r.tier, "unavailable");
});

test("isTierAvailable: unavailable always false", () => {
  assert.equal(isTierAvailable("unavailable", cloud()), false);
  assert.equal(isTierAvailable("unavailable", local()), false);
});

test("isTierAvailable: frontier false when not cloud-ok", () => {
  assert.equal(isTierAvailable("frontier", cloud()), true);
  assert.equal(isTierAvailable("frontier", local()), false);
  assert.equal(isTierAvailable("frontier", offline()), false);
});

test("isTierAvailable: operational always true", () => {
  assert.equal(isTierAvailable("operational", cloud()), true);
  assert.equal(isTierAvailable("operational", local()), true);
  assert.equal(isTierAvailable("operational", offline()), true);
});

test("reason string is present and non-empty", () => {
  const r = routeByRole("think", cloud());
  assert.ok(r.reason.length > 0);
});

test("noLocal: cloud-ok execute is promoted to frontier", () => {
  const r = routeByRole("execute", cloud(), { noLocal: true });
  assert.equal(r.tier, "frontier");
});

test("noLocal: cloud-ok cheap-web is promoted to frontier", () => {
  assert.equal(routeByRole("cheap-web", cloud(), { noLocal: true }).tier, "frontier");
});

test("noLocal: code-critical stays frontier with no debt in cloud-ok", () => {
  const r = routeByRole("code-critical", cloud(), { noLocal: true });
  assert.equal(r.tier, "frontier");
  assert.equal(r.frontierReviewDebt, false);
});

test("noLocal: local-only marks would-be-local roles unavailable (no fallback)", () => {
  const r = routeByRole("execute", local(), { noLocal: true });
  assert.equal(r.tier, "unavailable");
  // unavailable means "wait for cloud", not "ran locally" — so no review debt
  const cc = routeByRole("code-critical", local(), { noLocal: true });
  assert.equal(cc.tier, "unavailable");
  assert.equal(cc.frontierReviewDebt, false);
});

test("noLocal: offline marks would-be-local roles unavailable", () => {
  assert.equal(routeByRole("execute", offline(), { noLocal: true }).tier, "unavailable");
});

test("noLocal does not affect image role", () => {
  assert.equal(routeByRole("image", cloud(), { noLocal: true }).tier, "nanai");
});

test("cheap-web routes to operational in cloud-ok, unavailable with no cloud", () => {
  assert.equal(routeByRole("cheap-web", cloud()).tier, "operational");
  assert.equal(routeByRole("cheap-web", local()).tier, "unavailable");
  assert.equal(routeByRole("cheap-web", offline()).tier, "unavailable");
});
