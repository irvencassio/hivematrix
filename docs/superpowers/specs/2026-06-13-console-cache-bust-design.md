# Console Cache Bust Design

## Context

The installed HiveMatrix daemon is serving `0.1.12` APIs and the packaged console HTML contains the new Cloudflare Access fields, but a refreshed console window can still show the old `0.1.11` shell. The current `/` and `/console` responses only set `Content-Type`, which lets Chromium or a browser tab reuse stale HTML after an auto-update.

## Approach

Serve the operator console as an always-fresh document:

- Add explicit no-cache response headers for `/` and `/console`.
- Keep API responses unchanged.
- Keep the Cloudflare safety behavior unchanged: loopback console receives the local token, Cloudflare-origin console does not.

## Rejected Options

- Change the console URL with a version query parameter. This helps app navigation but not users who refresh an already-open browser tab.
- Force relaunch all windows after update. This is heavier and does not protect direct browser users.
- Add a service worker/cache clearing path. There is no service worker here, and the root issue is ordinary HTML cache policy.

## Verification

- Unit test for the cache-prevention headers.
- Existing console tests continue to pass.
- Rebuild daemon and reinstall/restart app so `/console` includes `Cache-Control: no-store`.
