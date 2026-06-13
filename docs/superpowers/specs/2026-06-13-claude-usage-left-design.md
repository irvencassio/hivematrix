# Claude Usage Left Design

## Problem

The main console has UI for Claude subscription "usage left", but `/usage` returns `subscription: null`, so the header and Frontier Usage panel fall back to spend. The local Claude Code Keychain entry contains a refresh token and plan metadata, but its access token is expired. The current HiveMatrix fetcher only accepts an unexpired access token and silently gives up.

## Approaches

1. Re-authenticate manually with `claude auth login`.
   - Fast for one machine, but not durable and the console still fails silently next time the access token expires.

2. Call Claude's OAuth refresh endpoint before fetching usage.
   - Matches Claude Code's own local behavior. Requires careful token handling and Keychain persistence.

3. Only expose a clearer error state.
   - Useful as a fallback, but it does not satisfy the main goal of showing remaining usage.

## Selected Design

Use approach 2 with approach 3 as guardrail.

HiveMatrix will read the existing `Claude Code-credentials` Keychain entry. If the access token is expired or within the refresh threshold, it will refresh with `https://platform.claude.com/v1/oauth/token` using the Claude Code public client id and the existing refresh token, persist the updated credential back to Keychain, then call the Anthropic OAuth usage endpoint.

`/usage` will also include a non-secret `subscriptionStatus` object so the console can explain when remaining usage is unavailable. The UI still leads with percent-left when the subscription usage fetch succeeds.

## Refresh Control

The console should expose a visible refresh button beside Frontier Usage. That button calls `/usage?refresh=1`, bypassing the short-lived subscription cache so a just-completed `claude auth login` is reflected immediately instead of waiting for the background interval.

## Auth Login Control

When `/usage` reports missing Claude credentials, a missing refresh token, or a refresh failure that asks for `claude auth login`, the Frontier Usage panel should expose a visible login button. The button calls a loopback-only authenticated daemon endpoint that writes a short `~/.hivematrix/claude-auth-login.command` script and opens it with Terminal. The script runs `claude auth login` with HiveMatrix's CLI PATH, then tells the operator to return to HiveMatrix and refresh usage.

## Security

No tokens are logged, exposed through `/usage`, or rendered in the console. Tests use fake tokens only. The Keychain write updates the same Claude Code credential service and keeps the refreshed token local to the Mac.

The login endpoint does not accept shell input from the browser. It opens a fixed local command script and relies on the Claude CLI's own OAuth flow to update Keychain.

## Verification

- Unit test expired-token refresh and usage fetch.
- Unit test missing credentials status.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
