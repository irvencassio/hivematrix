import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("console exposes a COO Dispatch operator surface in the Lanes tab", () => {
  const console = read("src/daemon/console.ts");

  // Section + inputs.
  assert.match(console, /COO Dispatch/);
  assert.match(console, /id="coo_text"/);
  assert.match(console, /id="coo_domains"/);
  assert.match(console, /id="coo_project_path"/);

  // Prepare + gated Create buttons and their handlers.
  assert.match(console, /cooDispatchPrepare\(/);
  assert.match(console, /cooDispatchCreate\(/);
  assert.match(console, /id="coo_create_btn"/);

  // Talks to the existing dispatch endpoint via the api() helper.
  assert.match(console, /api\("\/coo\/dispatch"/);

  // Create is gated to browser-safe prepared results only.
  assert.match(console, /status\s*===\s*"prepared"\s*&&[^\n]*lane\s*===\s*"browser"/);

  // Create is ALSO gated on site readiness being acceptable.
  assert.match(console, /readiness[^\n]*acceptable/);

  // Site readiness is surfaced beside the prepared result.
  assert.match(console, /readiness\.(siteName|color|status|traceRunId)/);

  // Surfaces the result fields the spec asks for.
  for (const field of ["status", "lane", "capability", "reason", "auditId", "taskId"]) {
    assert.ok(console.includes(field), `console should surface ${field}`);
  }

  // Lane wording in visible copy — no legacy "Bee" product name in the COO surface.
  const start = console.indexOf("COO Dispatch");
  const segment = console.slice(start, start + 2500);
  assert.doesNotMatch(segment, /BrowserBee|browserbee/);

  // Never render secret material in the operator surface.
  assert.doesNotMatch(segment, /password|credentialRef|cookie|\.secret\b/i);
});
