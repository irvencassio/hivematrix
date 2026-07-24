/**
 * Update channels — stable (default) and beta.
 *
 * The product rule (shared with Canopy Terminal and Canopy Browser): the
 * DOWNLOAD on the website is always the stable release, and beta is an in-app
 * OPT-IN. So a fresh install has no `updateChannel` key at all and resolves to
 * "stable"; nothing but an explicit operator choice in Settings can move it.
 *
 * ## Why two differently-shaped URLs
 *
 * The stable feed keeps the URL it has always had:
 *
 *     releases/latest/download/hivematrix-core.json
 *
 * `releases/latest/download/…` resolves to the release GitHub marks **Latest**,
 * which is also what the website's download link resolves through. That is
 * exactly the property we need: a beta must never become "Latest", or a
 * first-time visitor lands on a beta build. So beta releases are published as
 * **prereleases** — and a prerelease is, by construction, unreachable through
 * `releases/latest/download/`.
 *
 * The beta feed therefore cannot use that shape. It lives on a permanent
 * pointer release (`BETA_CHANNEL_TAG`) whose single feed asset is clobbered on
 * every beta publish:
 *
 *     releases/download/beta-channel/hivematrix-core-beta.json
 *
 * Consequences worth stating, because they are the whole safety argument:
 *   - Publishing a beta cannot touch the stable feed. Stable users are
 *     unaffected even if a beta publish fails halfway.
 *   - Nothing has to be "carried forward" onto beta releases to keep stable
 *     alive; stable is whatever release is still marked Latest.
 *   - A stable publish writes BOTH feeds, so a beta client is never left
 *     pinned below the newest stable (beta sees beta AND stable).
 *
 * Keep these constants in sync with `scripts/publish-release.sh`,
 * `scripts/verify-autoupdate-release.mts`, and the Rust shell's runtime
 * endpoint override in `src-tauri/src/lib.rs`.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type UpdateChannel = "stable" | "beta";

/** A fresh install is stable. Beta is only ever reached by an explicit opt-in. */
export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

export const RELEASE_REPO = "irvencassio/hivematrix";

/** Feed asset served to stable clients — the frozen legacy `latest.json` is untouched. */
export const STABLE_FEED_ASSET = "hivematrix-core.json";
/** Feed asset served to beta clients. */
export const BETA_FEED_ASSET = "hivematrix-core-beta.json";
/** Permanent pointer release that always carries the newest beta feed asset. */
export const BETA_CHANNEL_TAG = "beta-channel";

export const STABLE_FEED_URL =
  `https://github.com/${RELEASE_REPO}/releases/latest/download/${STABLE_FEED_ASSET}`;
export const BETA_FEED_URL =
  `https://github.com/${RELEASE_REPO}/releases/download/${BETA_CHANNEL_TAG}/${BETA_FEED_ASSET}`;

/**
 * Coerce a persisted/user-supplied value to a channel. Anything that is not the
 * literal string "beta" is stable — an unreadable, misspelled or corrupted
 * setting must fail SAFE (onto stable), never onto beta.
 */
export function parseUpdateChannel(value: unknown): UpdateChannel {
  return value === "beta" ? "beta" : DEFAULT_UPDATE_CHANNEL;
}

export function feedUrlForChannel(channel: UpdateChannel): string {
  return channel === "beta" ? BETA_FEED_URL : STABLE_FEED_URL;
}

/** The feed ASSET name for a channel (what the publish script writes). */
export function feedAssetForChannel(channel: UpdateChannel): string {
  return channel === "beta" ? BETA_FEED_ASSET : STABLE_FEED_ASSET;
}

function configPath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

/**
 * The operator's persisted channel. Read straight from `~/.hivematrix/config.json`
 * with no other module dependencies, so the daemon's update poller does not have
 * to pull in the whole settings model. A missing/unreadable file is stable.
 */
export function readUpdateChannel(path = configPath()): UpdateChannel {
  try {
    const cfg = JSON.parse(readFileSync(path, "utf-8")) as { updateChannel?: unknown };
    return parseUpdateChannel(cfg.updateChannel);
  } catch {
    return DEFAULT_UPDATE_CHANNEL;
  }
}
