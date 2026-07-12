import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, watch, readdirSync } from "fs";
import { join } from "path";
import { Task } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";
import { notifySuperwhisperPermissionRequest } from "@/lib/integrations/superwhisper-hive";
import { classifyAutoApprovalRequest, getAutoApprovalPolicy } from "@/lib/voice/auto-approval-policy";
import { readTrustLedger, recordApprovalOutcome, recordTrustAutoApproval } from "@/lib/approvals/trust-ledger";
import { decidePolicy } from "@/lib/approvals/decide-policy";
import { getAutonomyLevel } from "@/lib/config/autonomy";
import { recordAudit } from "@/lib/audit/audit";

const APPROVALS_DIR = join(process.env.HOME!, ".hivematrix", "approvals");
const HOOKS_DIR = join(process.env.HOME!, ".hivematrix", "hooks");
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Ensure directories exist
for (const dir of [APPROVALS_DIR, HOOKS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface ApprovalRequest {
  taskId: string;
  timestamp: string;
  tool: string;
  command: string;
  context: string;
}

// In-memory pending approvals: key = `${taskId}-${timestamp}`
const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
>();

/**
 * Generate a PreToolUse hook script for a specific task.
 * The hook checks if the tool is risky, writes an approval request file,
 * and polls for a decision file.
 */
export function generateHookScript(taskId: string): string {
  const scriptPath = join(HOOKS_DIR, `${taskId}.sh`);
  // The hook runs as a detached shell process with no way to read the
  // operator's live config — so the autonomy level is resolved once here, on
  // the Node side, at generation time, and baked into the script as a shell
  // constant. A later dial flip only takes effect on the next task spawn
  // (generateHookScript is called fresh per task in generateHookSettings).
  const autonomyLevel = getAutonomyLevel();
  // Hard safety floor (never bypassed, even under "autonomous"): an MCP tool
  // call whose name or input looks like a release/deploy/publish or a
  // destructive delete/rm/drop still requires approval. `rm` is matched as a
  // standalone token (non-letter boundaries) so it doesn't fire on ordinary
  // words like "confirm" or "term".
  const floorPattern = String.raw`(deploy|release|publish|destroy|delete|drop|[^a-zA-Z]rm[^a-zA-Z])`;
  const script = `#!/bin/bash
# Hive approval hook for task ${taskId}
# Reads tool info from stdin, checks if risky, requests approval if needed

# Autonomy level resolved at hook-generation time (Node side, see
# src/lib/config/autonomy.ts) and baked in as a constant. Only "autonomous"
# changes behavior below — manual/standard keep today's always-ask-for-MCP
# behavior unchanged.
AUTONOMY_LEVEL="${autonomyLevel}"
# Hard safety floor pattern (see comment above generateHookScript in
# approval.ts) — matched case-insensitively against the tool name + input. A
# hit here always requires approval, regardless of AUTONOMY_LEVEL.
FLOOR_PATTERN='${floorPattern}'

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
TOOL_INPUT=$(echo "$INPUT" | head -c 500)

# Write a valid JSON approval request file using python3 (handles escaping)
write_approval_json() {
  python3 -c "
import json, sys
json.dump({'taskId': sys.argv[1], 'timestamp': sys.argv[2], 'tool': sys.argv[3], 'command': sys.argv[4], 'context': sys.argv[5]}, open(sys.argv[6], 'w'))
" "$1" "$2" "$3" "$4" "$5" "$6"
}

# Safe tools — always allow
case "$TOOL_NAME" in
  Read|Glob|Grep|Agent|Edit|Write|Skill|TodoWrite|NotebookEdit|WebFetch|WebSearch|ToolSearch)
    exit 0
    ;;
esac

# Read-only SSH MCP tools — auto-approve when sshDiagnostics is enabled
if grep -q '"sshDiagnostics".*true' "$HOME/.hivematrix/config.json" 2>/dev/null; then
  case "$TOOL_NAME" in
    mcp__ssh__list_hosts|mcp__ssh__exec|mcp__ssh__read_file|mcp__ssh__compare_files|mcp__ssh__list_crontabs|mcp__ssh__check_cron_output)
      exit 0
      ;;
  esac
fi

# Superpowers / CCD session tools — approved by repository policy
case "$TOOL_NAME" in
  mcp__ccd_session__*|mcp__superpowers__*)
    exit 0
    ;;
esac

# Check for risky Bash commands
if [ "$TOOL_NAME" = "Bash" ]; then
  COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Allow safe bash commands
  if echo "$COMMAND" | grep -qE '^(git (status|diff|log|add|commit|branch|checkout|stash|push)|npm (test|run|install)|npx |yarn |pnpm |pip |python3?|swift |xcodebuild|cargo |go |make |ls|cat|head|tail|pwd|echo|mkdir|cd|find|wc|sort|grep|sed|awk|tr|cut|tee|touch|cp|mv|chmod|which|type|env|export|test |\\[)'; then
    exit 0
  fi

  # Risky: git push, rm, docker, curl POST/PUT/DELETE, npm publish
  if echo "$COMMAND" | grep -qE '(git reset|rm -rf|npm publish|docker |curl .*(POST|PUT|DELETE|PATCH))'; then
    TIMESTAMP=$(date +%s%N)
    REQUEST_FILE="${APPROVALS_DIR}/${taskId}-\${TIMESTAMP}.json"
    DECISION_FILE="${APPROVALS_DIR}/${taskId}-\${TIMESTAMP}.decision"

    # Write approval request (python3 handles JSON escaping)
    write_approval_json "${taskId}" "\${TIMESTAMP}" "$TOOL_NAME" "$COMMAND" "Risky Bash command detected" "$REQUEST_FILE"

    # Poll for decision (max 30 min = 1800 seconds)
    WAITED=0
    while [ ! -f "$DECISION_FILE" ] && [ $WAITED -lt 1800 ]; do
      sleep 1
      WAITED=$((WAITED + 1))
    done

    if [ -f "$DECISION_FILE" ]; then
      DECISION=$(cat "$DECISION_FILE")
      rm -f "$REQUEST_FILE" "$DECISION_FILE"
      if [ "$DECISION" = "approve" ] || [ "$DECISION" = "done" ]; then
        exit 0
      else
        echo "Action denied by operator" >&2
        exit 2
      fi
    else
      # Timeout
      rm -f "$REQUEST_FILE"
      echo "Approval timeout (30 min)" >&2
      exit 2
    fi
  fi
fi

# MCP tools — require approval, UNLESS autonomy is "autonomous" and this call
# doesn't hit the hard safety floor (release/deploy/publish/destructive
# delete-rm-drop). manual/standard always require approval here, unchanged.
if echo "$TOOL_NAME" | grep -q "^mcp__"; then
  FLOOR_HIT=0
  if echo " $TOOL_NAME $TOOL_INPUT " | grep -qiE "$FLOOR_PATTERN"; then
    FLOOR_HIT=1
  fi
  if [ "$AUTONOMY_LEVEL" = "autonomous" ] && [ "$FLOOR_HIT" -eq 0 ]; then
    exit 0
  fi

  TIMESTAMP=$(date +%s%N)
  REQUEST_FILE="${APPROVALS_DIR}/${taskId}-\${TIMESTAMP}.json"
  DECISION_FILE="${APPROVALS_DIR}/${taskId}-\${TIMESTAMP}.decision"

  MCP_REASON="MCP tool requires approval"
  if [ "$AUTONOMY_LEVEL" = "autonomous" ] && [ "$FLOOR_HIT" -eq 1 ]; then
    MCP_REASON="MCP tool requires approval (safety floor: release/deploy/publish/destructive-delete is never auto-approved)"
  fi
  write_approval_json "${taskId}" "\${TIMESTAMP}" "$TOOL_NAME" "$TOOL_INPUT" "$MCP_REASON" "$REQUEST_FILE"

  WAITED=0
  while [ ! -f "$DECISION_FILE" ] && [ $WAITED -lt 1800 ]; do
    sleep 1
    WAITED=$((WAITED + 1))
  done

  if [ -f "$DECISION_FILE" ]; then
    DECISION=$(cat "$DECISION_FILE")
    rm -f "$REQUEST_FILE" "$DECISION_FILE"
    if [ "$DECISION" = "approve" ] || [ "$DECISION" = "done" ]; then
      exit 0
    else
      echo "Action denied by operator" >&2
      exit 2
    fi
  else
    rm -f "$REQUEST_FILE"
    echo "Approval timeout (30 min)" >&2
    exit 2
  fi
fi

# Default: allow
exit 0
`;

  writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

/**
 * Generate a Claude Code settings file with the PreToolUse hook configured.
 */
export function generateHookSettings(taskId: string, projectPath: string): string {
  const hookScript = generateHookScript(taskId);
  const settingsPath = join(projectPath, ".claude", "settings.local.json");
  const claudeDir = join(projectPath, ".claude");

  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            {
              type: "command",
              command: hookScript,
            },
          ],
        },
      ],
    },
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}

/**
 * Watch the approvals directory for new request files and broadcast them.
 */
export function startApprovalWatcher() {
  watch(APPROVALS_DIR, async (eventType, filename) => {
    if (!filename?.endsWith(".json")) return;

    const filePath = join(APPROVALS_DIR, filename);
    if (!existsSync(filePath)) return;

    try {
      const content = readFileSync(filePath, "utf-8");
      const request: ApprovalRequest = JSON.parse(content);

      // Store in DB
      await Task.findByIdAndUpdate(request.taskId, {
        $push: {
          approvals: {
            timestamp: new Date(),
            tool: request.tool,
            command: request.command,
            context: request.context,
          },
        },
      });

      // Broadcast to dashboard (include timestamp so decision file matches)
      broadcast({
        type: "task:log",
        taskId: request.taskId,
        log: {
          type: "approval_request",
          content: `Approval needed: ${request.tool} — ${request.command}`,
          approvalTimestamp: request.timestamp,
          tool: request.tool,
          command: request.command,
        },
      });
      notifySuperwhisperPermissionRequest(request.taskId, request);

      // Set up timeout
      const key = `${request.taskId}-${request.timestamp}`;
      const timeout = setTimeout(() => {
        resolveApproval(request.taskId, request.timestamp, "denied", "timeout");
      }, APPROVAL_TIMEOUT_MS);

      pendingApprovals.set(key, {
        resolve: () => {},
        timeout,
      });
    } catch (err) {
      console.error(`[approval] Failed to process ${filename}:`, err);
    }
  });

  console.log("[approval] Watching for approval requests");
}

/**
 * Resolve an approval request (approve or deny).
 */
export async function resolveApproval(
  taskId: string,
  timestamp: string,
  decision: "approve" | "done" | "denied",
  via: string = "dashboard"
) {
  const decisionFile = join(APPROVALS_DIR, `${taskId}-${timestamp}.decision`);
  const allowed = decision === "approve" || decision === "done";

  // Write decision file (first-write-wins for race condition safety)
  try {
    writeFileSync(decisionFile, allowed ? decision : "denied", { flag: "wx" });
  } catch {
    // File already exists — another surface already resolved this
    return;
  }

  // Trust ramp: fold this operator decision into the trust ledger so a class the
  // operator keeps approving can later auto-approve under autonomous mode (and a
  // denial revokes it). Best-effort; only trust-eligible classes accumulate.
  // Skip auto-decisions (via "voice-auto"/"earned-trust") — trust is earned from
  // the operator's own choices, not from the ramp approving itself.
  if (via !== "timeout" && !via.startsWith("voice-auto") && !via.startsWith("earned-trust")) {
    try {
      recordApprovalOutcome({ category: classifyAutoApprovalRequest({ timestamp }) }, allowed);
    } catch { /* best effort */ }
  }

  // Update DB — set decision on approvals that don't have one yet
  try {
    await Task.findByIdAndUpdate(taskId, {
      $set: {
        "approvals.$[elem].decision": decision,
        "approvals.$[elem].decidedVia": via,
      },
    });
  } catch {
    // Best effort
  }

  // Clean up pending
  const key = `${taskId}-${timestamp}`;
  const pending = pendingApprovals.get(key);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingApprovals.delete(key);
  }

  // Broadcast resolution to all clients so every dashboard dismisses the banner
  const label = decision === "approve" ? "granted" : decision === "done" ? "granted (done)" : "denied";
  broadcast({
    type: "approval:resolved",
    taskId,
    timestamp,
    decision,
  });
  broadcast({
    type: "task:log",
    taskId,
    log: {
      type: "text",
      content: `Approval ${label} via ${via}`,
    },
  });
}

/**
 * Return all pending approval requests (json files with no matching decision file).
 * Used to hydrate new WS clients so approval banners survive reconnects.
 */
export function getPendingApprovals(): ApprovalRequest[] {
  try {
    const files = readdirSync(APPROVALS_DIR);
    // Stuck requests share this directory (stuck-*.json) but have a different
    // shape and their own getPendingStuck() reader — exclude them here.
    const jsonFiles = files.filter((f) => f.endsWith(".json") && !f.startsWith("stuck-"));
    const pending: ApprovalRequest[] = [];
    for (const f of jsonFiles) {
      const decisionFile = f.replace(".json", ".decision");
      if (files.includes(decisionFile)) continue;
      try {
        const content = readFileSync(join(APPROVALS_DIR, f), "utf-8");
        pending.push(JSON.parse(content));
      } catch {
        // skip malformed files
      }
    }
    return pending;
  } catch {
    return [];
  }
}

/**
 * Directive checkpoint approvals.
 *
 * A directive run checkpoint (W4.1) reuses this same file-based approval store
 * so the notify plane (W1.3) escalates it like any other approval and a
 * tap/text resolves it through resolveApproval(). The request is keyed by
 * `${runId}-checkpoint-${gate}` so it is created exactly once per (run, gate)
 * and the decision survives daemon restarts.
 */
export function requestCheckpointApproval(opts: { id: string; gate: string; goal: string; summary: string }): void {
  const requestFile = join(APPROVALS_DIR, `${opts.id}-checkpoint-${opts.gate}.json`);
  const decisionFile = join(APPROVALS_DIR, `${opts.id}-checkpoint-${opts.gate}.decision`);
  if (existsSync(requestFile) || existsSync(decisionFile)) return; // already requested / resolved
  const request: ApprovalRequest = {
    taskId: opts.id,
    timestamp: `checkpoint-${opts.gate}`,
    tool: "Directive checkpoint",
    command: opts.goal,
    context: opts.summary,
  };
  try {
    writeFileSync(requestFile, JSON.stringify(request), { flag: "wx" });
  } catch {
    // Another tick already wrote it — first-write-wins.
    return;
  }
  maybeAutoApproveRequest(request, decisionFile);
}

function maybeAutoApproveRequest(request: ApprovalRequest, decisionFile: string): void {
  const category = classifyAutoApprovalRequest(request);

  // Single decision point: composes the explicit operator policy and the trust
  // ramp (which carries the hard safety floor). Wrapped so a trust-ledger read
  // failure can never block — trust is an optimization, never a correctness dep.
  let verdict: ReturnType<typeof decidePolicy>;
  try {
    verdict = decidePolicy({
      category,
      tool: request.tool,
      policy: getAutoApprovalPolicy(),
      autonomyLevel: getAutonomyLevel(),
      ledger: readTrustLedger(),
    });
  } catch {
    return;
  }
  if (!verdict.autoApprove) return;
  if (verdict.recordTrustKey) recordTrustAutoApproval(verdict.recordTrustKey); // drives the every-Nth spot-check

  try {
    writeFileSync(decisionFile, "approve", { flag: "wx" });
  } catch {
    return;
  }
  try {
    recordAudit({ ts: new Date().toISOString(), event: "auto_approved", taskId: request.taskId, summary: `${request.tool}: ${verdict.reason}` });
  } catch { /* best effort */ }
  broadcast({
    type: "approval:resolved",
    taskId: request.taskId,
    timestamp: request.timestamp,
    decision: "approve",
  });
  broadcast({
    type: "task:log",
    taskId: request.taskId,
    log: {
      type: "text",
      content: `Approval granted via ${verdict.reason}`,
    },
  });
}

/** Read a resolved checkpoint decision, or null if still pending. */
export function readCheckpointDecision(id: string, gate: string): "approve" | "denied" | null {
  const decisionFile = join(APPROVALS_DIR, `${id}-checkpoint-${gate}.decision`);
  if (!existsSync(decisionFile)) return null;
  try {
    const value = readFileSync(decisionFile, "utf-8").trim();
    return value === "approve" || value === "done" ? "approve" : "denied";
  } catch {
    return null;
  }
}

/**
 * Clean up hook files for a completed/failed task.
 */
export function cleanupHookFiles(taskId: string) {
  const hookScript = join(HOOKS_DIR, `${taskId}.sh`);
  try {
    if (existsSync(hookScript)) {
      unlinkSync(hookScript);
    }
  } catch {
    // Best effort
  }
}
