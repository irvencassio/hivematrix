import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetSubscriptionCacheForTests,
  getSubscriptionRemainingDetailed,
  type SubscriptionTestDeps,
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
