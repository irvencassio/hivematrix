import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Normalize CRLF → LF so all indexOf/slice operations work regardless of
// how git checks out the file on this platform.
const approval = readFileSync(
  new URL("../src/lib/orchestrator/approval.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

// Extract the bash script template literal from the TS source.
// Finds the shebang line (unique in this file) through to the final "exit 0".
function extractScriptTemplate() {
  const shebang = "#!/bin/bash\n";
  const tail = "# Default: allow\nexit 0\n";

  const start = approval.indexOf(shebang);
  assert.ok(start > -1, "shebang not found in script template in approval.ts");

  const tailIdx = approval.indexOf(tail, start);
  assert.ok(tailIdx > start, "script tail '# Default: allow' not found in approval.ts");

  return approval.slice(start, tailIdx + tail.length).trimEnd();
}

test("approval.ts generateHookScript includes mcp__ccd_session__* allowlist", () => {
  assert.ok(
    approval.includes("mcp__ccd_session__*"),
    "generateHookScript must contain mcp__ccd_session__* case pattern"
  );
});

test("approval.ts CCD allowlist appears before catch-all MCP block", () => {
  const ccdIdx = approval.indexOf("mcp__ccd_session__*");
  const catchAllIdx = approval.indexOf("# MCP tools — always require approval");
  assert.ok(ccdIdx > -1, "must contain mcp__ccd_session__* allowlist");
  assert.ok(catchAllIdx > -1, "must still contain catch-all MCP block");
  assert.ok(ccdIdx < catchAllIdx, "CCD allowlist must come before catch-all block");
});

test("approval.ts CCD allowlist includes mcp__superpowers__* tools", () => {
  assert.ok(
    approval.includes("mcp__superpowers__*"),
    "generateHookScript must allowlist mcp__superpowers__* tools"
  );
});

test("generated hook script: CCD/Superpowers auto-allow appears before generic MCP catch-all", () => {
  const script = extractScriptTemplate();
  const ccdIdx = script.indexOf("mcp__ccd_session__*");
  const catchAllIdx = script.indexOf("# MCP tools — always require approval");
  assert.ok(ccdIdx > -1, "generated script must contain mcp__ccd_session__* case");
  assert.ok(catchAllIdx > -1, "generated script must contain catch-all MCP comment");
  assert.ok(
    ccdIdx < catchAllIdx,
    "CCD auto-allow must precede generic MCP catch-all in generated script"
  );
});

test("mcp__ccd_session__spawn_task exits 0 without creating an approval file", () => {
  const tmpDir = join(tmpdir(), `hive-approval-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const scriptContent = extractScriptTemplate()
      .replace(/\$\{taskId\}/g, "test-task")
      .replace(/\$\{APPROVALS_DIR\}/g, tmpDir);

    const scriptPath = join(tmpDir, "hook.sh");
    writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    execSync(`echo '{"tool_name":"mcp__ccd_session__spawn_task"}' | bash "${scriptPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const approvalFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(
      approvalFiles.length,
      0,
      "no approval files should be written for mcp__ccd_session__spawn_task"
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("unknown mcp__some_other_tool is caught by MCP catch-all, not CCD allowlist", () => {
  const script = extractScriptTemplate();

  // Sanity-check: the probe tool must not match either allowlisted prefix
  assert.ok(
    !"mcp__some_other_tool".startsWith("mcp__ccd_session__") &&
      !"mcp__some_other_tool".startsWith("mcp__superpowers__"),
    "test setup: probe tool must not match CCD/superpowers allowlist"
  );

  // The MCP catch-all pattern must exist after the CCD allowlist
  const ccdEnd = script.indexOf("mcp__ccd_session__*");
  const catchAllIdx = script.indexOf('grep -q "^mcp__"', ccdEnd);
  assert.ok(catchAllIdx > ccdEnd, "MCP catch-all must exist after CCD allowlist in generated script");

  // The catch-all block must initiate an approval request
  assert.ok(
    script.includes("MCP tool requires approval"),
    "MCP catch-all must write an approval request context string"
  );
});

test("risky Bash approval behavior unchanged in generated script", () => {
  const script = extractScriptTemplate();

  assert.ok(
    script.includes("git reset|rm -rf|npm publish"),
    "generated script must still detect risky Bash patterns"
  );

  assert.ok(
    script.includes("Risky Bash command detected"),
    "generated script must still request approval for risky Bash commands"
  );
});

test("safe tools behavior unchanged in generated script", () => {
  const script = extractScriptTemplate();

  for (const tool of ["Read", "Glob", "Grep", "Edit", "Write"]) {
    assert.ok(script.includes(tool), `generated script must still list safe tool: ${tool}`);
  }

  // Safe tools case must appear before the first approval request call site.
  // "write_approval_json" appears first in its own function definition, so anchor
  // on the context string that only appears inside the actual call sites.
  const safeToolsIdx = script.indexOf("Read|Glob|Grep");
  const firstCallIdx = script.indexOf("Risky Bash command detected");
  assert.ok(safeToolsIdx > -1, "safe tools case must exist in generated script");
  assert.ok(
    safeToolsIdx < firstCallIdx,
    "safe tools case must appear before approval-request call sites"
  );
});
