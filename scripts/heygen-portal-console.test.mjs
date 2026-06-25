import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("console exposes HeyGen portal operator controls", () => {
  const console = read("src/daemon/console.ts");

  // Panel + render entry.
  assert.match(console, /HeyGen portal/i);
  assert.match(console, /renderPortalVideos\(/);
  assert.match(console, /api\("\/video\/drafts"/);

  // Publish-to-YouTube (publish-only, no re-render) for portal_completed.
  assert.match(console, /publishPortalDraft\(/);
  assert.match(console, /api\("\/video\/publish-draft"/);
  assert.match(console, /Publish to YouTube/i);

  // Portal completion form → /video/portal-complete.
  assert.match(console, /submitPortalCompletion\(/);
  assert.match(console, /api\("\/video\/portal-complete"/);
  assert.match(console, /id="portal_parentDraftId"/);
  assert.match(console, /id="portal_localVideoPath"/);
  assert.match(console, /id="portal_finalVideoUrl"/);

  // Create portal task → /video/heygen-workflow with parentDraftId.
  assert.match(console, /createPortalTask\(/);
  assert.match(console, /api\("\/video\/heygen-workflow"/);
  assert.match(console, /parentDraftId/);

  // Portal states are surfaced.
  for (const s of ["portal_pending", "portal_completed", "needs_publish_input"]) {
    assert.ok(console.includes(s), `console should reference ${s}`);
  }
});

test("the portal panel never shows stale API-render copy and exposes no secrets", () => {
  const console = read("src/daemon/console.ts");
  const start = console.indexOf("renderPortalVideos");
  assert.ok(start > 0);
  const segment = console.slice(start, start + 3500);

  // Portal videos publish WITHOUT re-rendering — no avatar-render / $/sec copy here.
  assert.doesNotMatch(segment, /avatar render|render the HeyGen avatar|\$0\.05|~\$0/i);
  // needs_publish_input must explain there's no local file (manual only).
  assert.match(segment, /no local|manual/i);
  // No secret fields in the portal surface.
  assert.doesNotMatch(segment, /password|credentialRef|cookie|\.secret\b/i);
});
