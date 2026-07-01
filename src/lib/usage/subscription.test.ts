import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetSubscriptionCacheForTests,
  getSubscriptionRemainingDetailed,
  classifyWindowStatus,
  FIVE_HOUR_WINDOW_MS,
  SEVEN_DAY_WINDOW_MS,
  type SubscriptionTestDeps,
  type SubscriptionWindow,
} from "./subscription";

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test.afterEach(() => {
  _resetSubscriptionCacheForTests();
});

test("expired Claude OAuth token refreshes, persists, then fetches usage", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const securityWrites: unknown[] = [];
  const originalCredentials = {
    claudeAiOauth: {
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiresAt: 1000,
      scopes: ["user:profile", "user:inference"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_5x",
    },
  };
  const deps: SubscriptionTestDeps = {
    now: () => 10_000_000,
    execFileSync: (cmd, args) => {
      if (cmd !== "security") throw new Error(`unexpected cmd ${cmd}`);
      if (args[0] === "find-generic-password") return JSON.stringify(originalCredentials);
      if (args[0] === "add-generic-password") {
        securityWrites.push(args);
        return "";
      }
      throw new Error(`unexpected security args ${args.join(" ")}`);
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth/token")) {
        return response(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 28800,
          scope: "user:profile user:inference",
          organization: {
            organization_type: "claude_max",
            rate_limit_tier: "default_claude_max_5x",
          },
        });
      }
      if (String(url).endsWith("/api/oauth/usage")) {
        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fresh-access");
        return response(200, {
          five_hour: { utilization: 2, resets_at: "2026-06-13T20:00:00Z" },
          seven_day: { utilization: 25.5, resets_at: "2026-06-20T20:00:00Z" },
          seven_day_opus: null,
          seven_day_sonnet: { utilization: 10, resets_at: "2026-06-20T20:00:00Z" },
        });
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const result = await getSubscriptionRemainingDetailed(deps);

  assert.equal(result.usage?.fiveHour?.remaining, 98);
  assert.equal(result.usage?.sevenDay?.remaining, 74.5);
  assert.equal(result.status.state, "ok");
  assert.equal(result.status.refreshed, true);
  assert.equal(result.status.subscriptionType, "max");
  assert.equal(calls.length, 2);
  assert.equal(securityWrites.length, 1);
  assert.match(JSON.stringify(securityWrites[0]), /fresh-access/);
});

test("missing Claude credentials returns non-secret status", async () => {
  const deps: SubscriptionTestDeps = {
    now: () => 10_000_000,
    execFileSync: () => {
      throw new Error("not found");
    },
    fetch: async () => {
      throw new Error("should not fetch");
    },
  };

  const result = await getSubscriptionRemainingDetailed(deps);

  assert.equal(result.usage, null);
  assert.equal(result.status.state, "missing_credentials");
  assert.match(result.status.message, /Claude Code/);
});

test("expired Claude Max token without refresh token returns plan-aware status", async () => {
  const deps: SubscriptionTestDeps = {
    now: () => 10_000_000,
    execFileSync: (cmd, args) => {
      if (cmd !== "security") throw new Error(`unexpected cmd ${cmd}`);
      if (args[0] === "find-generic-password") {
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: "expired-access",
            expiresAt: 1000,
            subscriptionType: "max",
            rateLimitTier: "default_claude_max_5x",
          },
        });
      }
      throw new Error(`unexpected security args ${args.join(" ")}`);
    },
    fetch: async () => {
      throw new Error("should not fetch");
    },
  };

  const result = await getSubscriptionRemainingDetailed(deps);

  assert.equal(result.usage, null);
  assert.equal(result.status.state, "missing_refresh_token");
  assert.equal(result.status.subscriptionType, "max");
  assert.equal(result.status.rateLimitTier, "default_claude_max_5x");
});

// --- classifyWindowStatus ---------------------------------------------------

function win(utilization: number, resetsInMs: number, now: number): SubscriptionWindow {
  return { utilization, remaining: 100 - utilization, resetsAt: new Date(now + resetsInMs).toISOString() };
}

test("classifyWindowStatus: day 7 stays green while sufficient 7-day budget remains", () => {
  const now = 0;
  assert.equal(classifyWindowStatus(win(69, 18.5 * 60 * 60 * 1000, now), SEVEN_DAY_WINDOW_MS, now), "green");
  assert.equal(classifyWindowStatus(win(85.7, 18.5 * 60 * 60 * 1000, now), SEVEN_DAY_WINDOW_MS, now), "green");
  assert.equal(classifyWindowStatus(win(86, 18.5 * 60 * 60 * 1000, now), SEVEN_DAY_WINDOW_MS, now), "red");
});

test("classifyWindowStatus: day 1 turns red only after the first daily allowance is exceeded", () => {
  const now = 0;
  const dayOneReset = (6 * 24 + 5) * 60 * 60 * 1000;
  assert.equal(classifyWindowStatus(win(14, dayOneReset, now), SEVEN_DAY_WINDOW_MS, now), "green");
  assert.equal(classifyWindowStatus(win(15, dayOneReset, now), SEVEN_DAY_WINDOW_MS, now), "red");
});

test("classifyWindowStatus: day 2 turns red only after the second daily allowance is exceeded", () => {
  const now = 0;
  const dayTwoReset = (5 * 24 + 5) * 60 * 60 * 1000;
  assert.equal(classifyWindowStatus(win(28.6, dayTwoReset, now), SEVEN_DAY_WINDOW_MS, now), "green");
  assert.equal(classifyWindowStatus(win(29, dayTwoReset, now), SEVEN_DAY_WINDOW_MS, now), "red");
});

test("classifyWindowStatus: expired window falls back to absolute thresholds", () => {
  const now = 1000;
  const w = win(85, -500, now); // resetsAt is in the past
  assert.equal(classifyWindowStatus(w, SEVEN_DAY_WINDOW_MS, now), "red");
});

test("classifyWindowStatus: expired window — yellow at 65%", () => {
  const now = 1000;
  const w = win(65, -500, now);
  assert.equal(classifyWindowStatus(w, SEVEN_DAY_WINDOW_MS, now), "yellow");
});

test("classifyWindowStatus: expired window — green at 55%", () => {
  const now = 1000;
  const w = win(55, -500, now);
  assert.equal(classifyWindowStatus(w, SEVEN_DAY_WINDOW_MS, now), "green");
});

test("classifyWindowStatus: works with FIVE_HOUR_WINDOW_MS constant", () => {
  const now = 0;
  const w = win(50, FIVE_HOUR_WINDOW_MS / 2, now); // 50% elapsed, 50% used — on pace
  assert.equal(classifyWindowStatus(w, FIVE_HOUR_WINDOW_MS, now), "green");
});
