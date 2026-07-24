/**
 * Source guard for the beta/stable update-channel wiring.
 *
 * The feed URLs necessarily exist in four places that cannot import each other:
 * the TS daemon poller (channel.ts), the Rust shell that actually installs
 * (lib.rs), the publish script that writes the feeds (publish-release.sh), and
 * the release metadata writer. A drift between any two of them is invisible
 * until a real user's update silently stops arriving — or, far worse, until a
 * stable user is handed a beta build. These asserts fail the release (npm test
 * runs before publish) if the pieces stop agreeing.
 */

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");

const STABLE_URL = "https://github.com/irvencassio/hivematrix/releases/latest/download/hivematrix-core.json";
const BETA_URL = "https://github.com/irvencassio/hivematrix/releases/download/beta-channel/hivematrix-core-beta.json";

test("the app ships pointed at the STABLE feed — a fresh install cannot resolve beta", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const endpoints = conf.plugins?.updater?.endpoints ?? [];
  assert.deepEqual(endpoints, [STABLE_URL],
    "plugins.updater.endpoints is the compiled-in default and must be the stable feed only");
  assert.doesNotMatch(JSON.stringify(endpoints), /beta/i,
    "no beta endpoint may be baked into the bundle — beta is a runtime override");
});

test("every copy of the feed URLs agrees", () => {
  const channel = read("src/lib/updater/channel.ts");
  assert.ok(channel.includes(STABLE_URL.replace("hivematrix-core.json", "${STABLE_FEED_ASSET}")) ||
    channel.includes("releases/latest/download/${STABLE_FEED_ASSET}"),
  "channel.ts builds the stable URL from releases/latest/download");
  assert.match(channel, /BETA_CHANNEL_TAG = "beta-channel"/);
  assert.match(channel, /BETA_FEED_ASSET = "hivematrix-core-beta\.json"/);
  assert.match(channel, /STABLE_FEED_ASSET = "hivematrix-core\.json"/);

  const lib = read("src-tauri/src/lib.rs");
  assert.ok(lib.includes(BETA_URL), "the Rust shell's BETA_FEED_URL must match channel.ts");

  const publish = read("scripts/publish-release.sh");
  assert.match(publish, /BETA_TAG="beta-channel"/);
  assert.match(publish, /BETA_FEED_ASSET="hivematrix-core-beta\.json"/);
  assert.match(publish, /FEED_ASSET="hivematrix-core\.json"/);

  const meta = read("scripts/write-release-metadata.mjs");
  assert.match(meta, /BETA_CHANNEL_TAG = "beta-channel"/);
  assert.match(meta, /BETA_FEED_ASSET = "hivematrix-core-beta\.json"/);
});

test("the Rust shell overrides the endpoint at runtime and fails safe to stable", () => {
  const lib = read("src-tauri/src/lib.rs");

  // Runtime override is what makes a channel switch a setting rather than a
  // reinstall. If this reverts to app.updater(), beta silently stops working
  // while the setting still claims to be on.
  assert.match(lib, /fn channel_updater/);
  assert.match(lib, /updater_builder\(\)/);
  assert.match(lib, /\.endpoints\(vec!\[url\]\)/);
  assert.match(lib, /let updater = match channel_updater\(&app\)/,
    "check_for_update must build the updater through the channel resolver");

  // The opt-in test itself: only the exact key/value, and unreadable config
  // must fall through to stable via unwrap_or(false).
  assert.match(lib, /"\\"updateChannel\\":\\"beta\\""/);
  assert.match(lib, /fn beta_channel_selected\(\)[\s\S]*?\.unwrap_or\(false\)/);
});

test("publish defaults to beta, and only --stable can touch the Latest pointer", () => {
  const publish = read("scripts/publish-release.sh");

  assert.match(publish, /^CHANNEL="beta"$/m, "publishing defaults to the beta channel");
  assert.match(publish, /--stable\)\s*CHANNEL="stable"/);

  // A beta release must be a prerelease and explicitly NOT latest: the website
  // download and the stable feed both resolve through "Latest".
  assert.match(publish, /LATEST_FLAGS=\(--prerelease --latest=false\)/);
  assert.match(publish, /LATEST_FLAGS=\(--latest --prerelease=false\)/);

  // A beta release must never carry the stable feed asset.
  const betaBranch = publish.slice(publish.indexOf('if [ "$CHANNEL" = "stable" ]; then\n  # The stable feed IS'));
  assert.match(betaBranch, /ASSETS\+=\("\$BETA_MANIFEST"\)/);

  // A stable publish must advance BOTH feeds, or beta clients get stranded
  // below the newest stable and "beta sees beta AND stable" stops holding.
  assert.match(publish, /gh release upload "\$BETA_TAG" "\$BETA_MANIFEST"/,
    "the beta pointer release is updated on EVERY publish, stable included");
});

test("the settings surface exposes the channel and defaults it to stable", () => {
  const console_ = read("src/daemon/console.ts");
  assert.match(console_, /id="s_updatechannel"/, "Settings must carry a channel control");
  assert.match(console_, /<option value="stable"/);
  assert.match(console_, /<option value="beta"/);
  assert.match(console_, /async function saveUpdateChannel/);
  assert.match(console_, /s_updatechannel"\)\.value = m\.updateChannel === "beta" \? "beta" : "stable"/,
    "the control must render stable unless the persisted value is exactly beta");

  const server = read("src/daemon/server.ts");
  assert.match(server, /updateChannel: getUpdateChannel\(\)/, "GET must report the channel");
  assert.match(server, /body\.updateChannel === "stable" \|\| body\.updateChannel === "beta"/,
    "POST must accept only the two known channels");
});
