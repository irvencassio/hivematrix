import test from "node:test";
import assert from "node:assert/strict";

import { extractCodexUsageProfileFromText, parseCodexAuthStateFromText } from "./codex";

const CHATGPT_AUTH_JSON = JSON.stringify({
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: {
    id_token: [
      "header",
      Buffer.from(JSON.stringify({
        name: "Irven Cassio",
        email: "irvencassio@gmail.com",
        "https://api.openai.com/auth": {
          chatgpt_plan_type: "prolite",
        },
      })).toString("base64url"),
      "sig",
    ].join("."),
  },
});

const API_KEY_AUTH_JSON = JSON.stringify({
  auth_mode: "apikey",
  OPENAI_API_KEY: "sk-test",
  tokens: {},
});

const TOKEN_COUNT_EVENT = JSON.stringify({
  payload: {
    type: "token_count",
    rate_limits: {
      primary: {
        used_percent: 7,
        resets_at: 1777679821,
      },
      secondary: {
        used_percent: 2,
        resets_at: 1778241748,
      },
      plan_type: "plus",
    },
  },
});

test("parseCodexAuthStateFromText detects ChatGPT subscription logins", () => {
  assert.deepEqual(parseCodexAuthStateFromText(CHATGPT_AUTH_JSON), {
    authMode: "subscription",
    accountName: "Irven Cassio",
    accountEmail: "irvencassio@gmail.com",
    planType: "prolite",
  });
});

test("extractCodexUsageProfileFromText returns subscription usage when rate limits exist", () => {
  const profile = extractCodexUsageProfileFromText({
    authJsonText: CHATGPT_AUTH_JSON,
    sessionJsonlText: `${TOKEN_COUNT_EVENT}\n`,
    fetchedAt: "2026-05-07T12:31:15.742Z",
  });

  assert.equal(profile?.provider, "codex");
  assert.equal(profile?.profile, "chatgpt");
  assert.equal(profile?.planType, "plus");
  assert.equal(profile?.fiveHour?.utilization, 7);
  assert.equal(profile?.sevenDay?.utilization, 2);
  assert.equal(profile?.error, undefined);
});

test("extractCodexUsageProfileFromText keeps subscription row visible when usage has not arrived yet", () => {
  const profile = extractCodexUsageProfileFromText({
    authJsonText: CHATGPT_AUTH_JSON,
    sessionJsonlText: "",
    fetchedAt: "2026-05-07T12:31:15.742Z",
  });

  assert.equal(profile?.provider, "codex");
  assert.equal(profile?.profile, "chatgpt");
  assert.equal(profile?.error, "Usage unavailable");
  assert.equal(profile?.fiveHour, null);
});

test("extractCodexUsageProfileFromText skips API-key Codex auth", () => {
  const profile = extractCodexUsageProfileFromText({
    authJsonText: API_KEY_AUTH_JSON,
    sessionJsonlText: `${TOKEN_COUNT_EVENT}\n`,
    fetchedAt: "2026-05-07T12:31:15.742Z",
  });

  assert.equal(profile, null);
});
