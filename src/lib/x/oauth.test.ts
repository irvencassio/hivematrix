import test from "node:test";
import assert from "node:assert/strict";
import { percentEncode, buildOAuthHeader, type OAuth1Creds } from "./oauth";
import { getXCreds, isXConfigured } from "./provider";

test("percentEncode follows RFC-3986 (encodes !*'() and spaces)", () => {
  assert.equal(percentEncode("a b"), "a%20b");
  assert.equal(percentEncode("hello!*'()"), "hello%21%2A%27%28%29");
  assert.equal(percentEncode("a+b=c&d"), "a%2Bb%3Dc%26d");
});

const creds: OAuth1Creds = {
  consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessSecret: "as",
};

test("buildOAuthHeader is deterministic for fixed nonce/timestamp and includes all fields", () => {
  const h = buildOAuthHeader("POST", "https://api.twitter.com/2/tweets", creds, { nonce: "abc123", timestamp: "1700000000" });
  assert.match(h, /^OAuth /);
  for (const field of ["oauth_consumer_key", "oauth_nonce", "oauth_signature_method", "oauth_timestamp", "oauth_token", "oauth_version", "oauth_signature"]) {
    assert.ok(h.includes(`${field}=`), `header must include ${field}`);
  }
  assert.match(h, /oauth_signature_method="HMAC-SHA1"/);
  // deterministic: same inputs → same signature
  const h2 = buildOAuthHeader("POST", "https://api.twitter.com/2/tweets", creds, { nonce: "abc123", timestamp: "1700000000" });
  assert.equal(h, h2);
  // changing the nonce changes the signature
  const h3 = buildOAuthHeader("POST", "https://api.twitter.com/2/tweets", creds, { nonce: "different", timestamp: "1700000000" });
  assert.notEqual(h, h3);
});

test("getXCreds requires all four keys; isXConfigured reflects that", () => {
  const full = { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" } as NodeJS.ProcessEnv;
  assert.ok(getXCreds(full));
  assert.equal(isXConfigured(full), true);
  assert.equal(getXCreds({ X_API_KEY: "a" } as NodeJS.ProcessEnv), null);
  assert.equal(isXConfigured({} as NodeJS.ProcessEnv), false);
});
