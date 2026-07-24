import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BETA_CHANNEL_TAG,
  BETA_FEED_ASSET,
  BETA_FEED_URL,
  DEFAULT_UPDATE_CHANNEL,
  STABLE_FEED_ASSET,
  STABLE_FEED_URL,
  feedAssetForChannel,
  feedUrlForChannel,
  parseUpdateChannel,
  readUpdateChannel,
} from "./channel";

test("the default channel is stable — a fresh install can never land on beta", () => {
  assert.equal(DEFAULT_UPDATE_CHANNEL, "stable");
  assert.equal(parseUpdateChannel(undefined), "stable");
  assert.equal(parseUpdateChannel(null), "stable");
});

test("only the literal string 'beta' opts in — anything else fails safe to stable", () => {
  assert.equal(parseUpdateChannel("beta"), "beta");
  // Every one of these has to land on stable. A corrupted, half-written or
  // hand-edited config must degrade toward the SAFE channel, never toward beta.
  for (const bad of ["Beta", "BETA", "betas", " beta", true, 1, {}, [], "stable", "nightly"]) {
    assert.equal(parseUpdateChannel(bad), "stable", `parseUpdateChannel(${JSON.stringify(bad)})`);
  }
});

test("the stable feed keeps the releases/latest/download URL the app already ships", () => {
  // Unchanged on purpose: v0.1.253 is already published there and already what
  // the website points at, so stable is established by construction — no new
  // version has to be cut to "create" a stable baseline.
  assert.equal(
    STABLE_FEED_URL,
    "https://github.com/irvencassio/hivematrix/releases/latest/download/hivematrix-core.json",
  );
  assert.equal(feedUrlForChannel("stable"), STABLE_FEED_URL);
  assert.equal(feedAssetForChannel("stable"), STABLE_FEED_ASSET);
});

test("the beta feed uses a fixed pointer release, NOT releases/latest/download", () => {
  // This is the whole safety argument. `releases/latest/download/…` resolves to
  // whatever GitHub marks "Latest", which is also what the website download
  // resolves through — so a beta must never be Latest, which means it is
  // published as a prerelease, which means releases/latest/download cannot
  // reach it. Hence a fixed pointer tag.
  assert.equal(
    BETA_FEED_URL,
    `https://github.com/irvencassio/hivematrix/releases/download/${BETA_CHANNEL_TAG}/${BETA_FEED_ASSET}`,
  );
  assert.doesNotMatch(BETA_FEED_URL, /releases\/latest\/download/,
    "the beta feed must not resolve through the Latest pointer");
  assert.equal(feedUrlForChannel("beta"), BETA_FEED_URL);
  assert.notEqual(BETA_FEED_ASSET, STABLE_FEED_ASSET, "the two channels must be distinct assets");
});

test("readUpdateChannel round-trips an opt-in and treats a missing/broken config as stable", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-channel-"));
  const path = join(dir, "config.json");
  try {
    assert.equal(readUpdateChannel(path), "stable", "a config that does not exist yet is stable");

    writeFileSync(path, JSON.stringify({ updateChannel: "beta", autoUpdate: true }));
    assert.equal(readUpdateChannel(path), "beta");

    // Stable is stored as the ABSENCE of the key (see setUpdateChannel).
    writeFileSync(path, JSON.stringify({ autoUpdate: true }));
    assert.equal(readUpdateChannel(path), "stable");

    writeFileSync(path, "{ this is not json");
    assert.equal(readUpdateChannel(path), "stable", "an unreadable config must not strand the app on beta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
