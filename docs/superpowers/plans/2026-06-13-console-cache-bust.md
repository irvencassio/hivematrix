# Console Cache Bust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add a failing server test for console cache headers.
  - File: `src/daemon/server.test.ts`
  - Assert the exported header helper includes `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, `Expires: 0`, and `Content-Type: text/html; charset=utf-8`.

- [ ] Implement the console HTML header helper and wire console routes.
  - File: `src/daemon/server.ts`
  - Add `consoleHtmlHeaders()`.
  - Use it for `GET /` and `GET /console`.

- [ ] Verify focused tests and rebuild/deploy.
  - Run `node --import tsx/esm --test src/daemon/server.test.ts src/daemon/console.test.ts`.
  - Run `npm run typecheck`.
  - Run `npm test`.
  - Run `node scripts/scope-wall.mjs`.
  - Rebuild daemon, package/install if needed, restart HiveMatrix.
