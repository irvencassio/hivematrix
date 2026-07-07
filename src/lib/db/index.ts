import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { normalizeBrainSelection } from "@/lib/brain/selection";

// DB path is resolved lazily (from $HOME at open time) so tests can point it
// at a temp dir via HIVEMATRIX_DB_PATH / HOME before the first getDb() call.
function resolveDbPath(): string {
  if (process.env.HIVEMATRIX_DB_PATH) return process.env.HIVEMATRIX_DB_PATH;
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "hivematrix.db");
}

// Singleton database instance (shared across orchestrator + API routes via globalThis)
const g = globalThis as unknown as { __hivematrixSqlite?: Database.Database };

// ------------------------------------------------------------------
// Schema migrations — each entry runs once, tracked via PRAGMA user_version.
// Append-only: never edit or reorder existing entries.
// ------------------------------------------------------------------
const MIGRATIONS: string[] = [
  // v1: core tasks table (goals/missions/scheduledTasks dropped; directive replaces them)
  `CREATE TABLE IF NOT EXISTS tasks (
      _id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      project TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      position INTEGER DEFAULT 0,
      agentPid INTEGER,
      sessionId TEXT,
      resumeSessionId TEXT,
      source TEXT DEFAULT 'dashboard',
      workflow TEXT DEFAULT 'standalone',
      model TEXT,
      profile TEXT,
      nextStep TEXT,
      parentTaskId TEXT,
      centralTaskId TEXT,
      output TEXT DEFAULT '{}',
      logs TEXT DEFAULT '[]',
      approvals TEXT DEFAULT '[]',
      comments TEXT DEFAULT '[]',
      error TEXT,
      executor TEXT DEFAULT 'agent',
      dependsOn TEXT DEFAULT '[]',
      workflowStepIndex INTEGER DEFAULT 0,
      worktreeName TEXT DEFAULT NULL,
      launchCommand TEXT DEFAULT NULL,
      agentType TEXT DEFAULT 'auto',
      turns TEXT DEFAULT '[]',
      thinkingMode TEXT DEFAULT 'auto',
      delayUntil TEXT DEFAULT NULL,
      timeoutMinutes INTEGER DEFAULT 60,
      maxBudgetUsd REAL DEFAULT 5.0,
      completedBy TEXT DEFAULT NULL,
      proverType TEXT DEFAULT NULL,
      completionNote TEXT DEFAULT NULL,
      assignedAt TEXT,
      startedAt TEXT,
      completedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_position ON tasks(status, position);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_path_status ON tasks(projectPath, status);`,

  // v2: task_history archive table + usage_totals aggregation table
  `CREATE TABLE IF NOT EXISTS task_history (
      _id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      project TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      status TEXT NOT NULL,
      executor TEXT DEFAULT 'agent',
      workflow TEXT DEFAULT 'standalone',
      model TEXT,
      profile TEXT,
      output TEXT DEFAULT '{}',
      logs TEXT DEFAULT '[]',
      approvals TEXT DEFAULT '[]',
      comments TEXT DEFAULT '[]',
      error TEXT,
      cost REAL DEFAULT 0,
      turns INTEGER DEFAULT 0,
      inputTokens INTEGER DEFAULT 0,
      outputTokens INTEGER DEFAULT 0,
      cacheReadTokens INTEGER DEFAULT 0,
      cacheCreationTokens INTEGER DEFAULT 0,
      contextWindow INTEGER DEFAULT 0,
      timeoutMinutes INTEGER DEFAULT 60,
      maxBudgetUsd REAL DEFAULT 5.0,
      createdAt TEXT,
      startedAt TEXT,
      completedAt TEXT,
      archivedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_project ON task_history(project);
    CREATE INDEX IF NOT EXISTS idx_history_profile ON task_history(profile);
    CREATE INDEX IF NOT EXISTS idx_history_archived ON task_history(archivedAt);
    CREATE INDEX IF NOT EXISTS idx_history_completed ON task_history(completedAt);`,

  // v3: usage_totals aggregation table
  `CREATE TABLE IF NOT EXISTS usage_totals (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT NOT NULL,
      project TEXT NOT NULL,
      period TEXT NOT NULL,
      periodStart TEXT NOT NULL,
      taskCount INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      inputTokens INTEGER DEFAULT 0,
      outputTokens INTEGER DEFAULT 0,
      cacheReadTokens INTEGER DEFAULT 0,
      cacheCreationTokens INTEGER DEFAULT 0,
      turns INTEGER DEFAULT 0,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_totals_key ON usage_totals(profile, project, period, periodStart);`,

  // v4: artifacts table for agent-produced visual output
  `CREATE TABLE IF NOT EXISTS artifacts (
      _id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scopeId TEXT,
      filename TEXT NOT NULL,
      title TEXT,
      mimeType TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL DEFAULT 0,
      stem TEXT NOT NULL DEFAULT '',
      versionNum INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'active',
      supersededBy TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON artifacts(scope, scopeId);
    CREATE INDEX IF NOT EXISTS idx_artifacts_stem ON artifacts(scope, scopeId, stem);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_file ON artifacts(scope, scopeId, filename);`,

  // v5: messaging control-plane — channels, identities, deliveries, inbound, sessions
  `CREATE TABLE IF NOT EXISTS message_channels (
      _id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      transport TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'off',
      lastStartAt TEXT,
      lastStopAt TEXT,
      lastInboundAt TEXT,
      lastOutboundAt TEXT,
      lastError TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_channels_channel ON message_channels(channel);
    CREATE TABLE IF NOT EXISTS message_identities (
      _id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      address TEXT NOT NULL,
      displayName TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      capabilities TEXT NOT NULL DEFAULT '[]',
      pairedAt TEXT,
      lastSeenAt TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_identities_channel_address ON message_identities(channel, address);
    CREATE INDEX IF NOT EXISTS idx_message_identities_status ON message_identities(channel, status);`,

  // v6: directives table — replaces goals/missions/scheduled_tasks as the unified planning primitive
  `CREATE TABLE IF NOT EXISTS directives (
      _id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      triggerPolicy TEXT NOT NULL DEFAULT 'manual',
      budgetPolicy TEXT NOT NULL DEFAULT '{}',
      approvalPolicy TEXT NOT NULL DEFAULT '{}',
      brainSelection TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      profile TEXT NOT NULL,
      project TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      lastRunId TEXT,
      lastRunAt TEXT,
      nextRunAt TEXT,
      retiredReason TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_directives_profile_status ON directives(profile, status);
    CREATE INDEX IF NOT EXISTS idx_directives_project ON directives(project);
    CREATE INDEX IF NOT EXISTS idx_directives_next_run ON directives(nextRunAt);`,

  // v7: runs table — execution records for each directive invocation
  `CREATE TABLE IF NOT EXISTS runs (
      _id TEXT PRIMARY KEY,
      directiveId TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'plan',
      planSummary TEXT,
      reflectionText TEXT,
      startedAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT,
      failedAt TEXT,
      failReason TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runs_directive ON runs(directiveId);
    CREATE INDEX IF NOT EXISTS idx_runs_phase ON runs(directiveId, phase);`,

  // v8: run_journal table — step-by-step recovery log for resumable runs
  `CREATE TABLE IF NOT EXISTS run_journal (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      runId TEXT NOT NULL,
      directiveId TEXT NOT NULL,
      step TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      recordedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_journal_run ON run_journal(runId);
    CREATE INDEX IF NOT EXISTS idx_run_journal_directive ON run_journal(directiveId);`,

  // v9: directive_criteria table — verified-completion criteria for directives
  `CREATE TABLE IF NOT EXISTS directive_criteria (
      _id TEXT PRIMARY KEY,
      directiveId TEXT NOT NULL,
      description TEXT NOT NULL,
      proverId TEXT,
      proverType TEXT,
      proven INTEGER NOT NULL DEFAULT 0,
      provenAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_directive_criteria_directive ON directive_criteria(directiveId);
    CREATE INDEX IF NOT EXISTS idx_directive_criteria_proven ON directive_criteria(directiveId, proven);`,

  // v10: add directiveId FK on tasks — links a task back to its originating directive
  `ALTER TABLE tasks ADD COLUMN directiveId TEXT DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_directive ON tasks(directiveId);`,

  // v11: add delayReason on tasks — the scheduler tags usage-limit delays so
  // clearStaleUsageDelays can distinguish them from other delay causes.
  `ALTER TABLE tasks ADD COLUMN delayReason TEXT DEFAULT NULL;`,

  // v12: add brainSelection on tasks — pinned brain doc paths persisted per
  // task (the Task store reads/writes it; was missing from the base schema).
  `ALTER TABLE tasks ADD COLUMN brainSelection TEXT NOT NULL DEFAULT '[]';`,

  // v13: add reviewState on tasks — distinguishes needs_input from
  // ready_for_review under the review status (set by agent-manager on exit).
  `ALTER TABLE tasks ADD COLUMN reviewState TEXT DEFAULT NULL;`,

  // v14: frontier-review-debt queue — code-critical work that ran locally
  // (mixed mode, cloud unavailable) is recorded here and replayed as a frontier
  // review task when cloud-ok returns.
  `CREATE TABLE IF NOT EXISTS frontier_review_debt (
      _id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      project TEXT,
      projectPath TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewTaskId TEXT,
      enqueuedAt TEXT NOT NULL DEFAULT (datetime('now')),
      drainedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_frontier_debt_task ON frontier_review_debt(taskId);
    CREATE INDEX IF NOT EXISTS idx_frontier_debt_status ON frontier_review_debt(status);`,

  // v15: telemetry_events — opt-in, local-first event log (privacy is a selling
  // point, so nothing is recorded unless config.telemetry.enabled is true and
  // nothing leaves the machine without an explicit "send diagnostics").
  `CREATE TABLE IF NOT EXISTS telemetry_events (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      connectivity TEXT,
      version TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_category ON telemetry_events(category);
    CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_events(createdAt);`,

  // v16: feedback — bugs and enhancement requests filed by the founder (by text,
  // console, or mobile) and triaged locally. Lightweight backlog, not a tracker.
  `CREATE TABLE IF NOT EXISTS feedback (
      _id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'console',
      status TEXT NOT NULL DEFAULT 'open',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_kind ON feedback(kind);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);`,

  // v17: task_telemetry — one normalized row per task-run (observability).
  // NULL columns mean "unavailable" (e.g. Codex tokens before recovery) — never
  // a fake 0. gen_ai.* shaped for portability.
  `CREATE TABLE IF NOT EXISTS task_telemetry (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      runIndex INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      role TEXT,
      connectivity TEXT,
      status TEXT NOT NULL,
      inputTokens INTEGER,
      outputTokens INTEGER,
      cacheReadTokens INTEGER,
      cacheCreationTokens INTEGER,
      reasoningTokens INTEGER,
      totalTokens INTEGER,
      tokensPerSec REAL,
      latencyMs INTEGER,
      ttftMs INTEGER,
      turns INTEGER,
      toolCalls INTEGER,
      costUsd REAL,
      directiveId TEXT,
      runId TEXT,
      proverType TEXT,
      project TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_telemetry_task ON task_telemetry(taskId);
    CREATE INDEX IF NOT EXISTS idx_task_telemetry_created ON task_telemetry(createdAt);
    CREATE INDEX IF NOT EXISTS idx_task_telemetry_provider ON task_telemetry(provider);`,

  // v18: Lane and Browser Lane control-plane schema. Secrets never live here:
  // browser_credentials stores only Keychain credentialRef metadata.
  `CREATE TABLE IF NOT EXISTS lane_providers (
      _id TEXT PRIMARY KEY,
      lane TEXT NOT NULL,
      provider TEXT NOT NULL,
      displayName TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      backendPolicy TEXT NOT NULL DEFAULT 'lane_owned_first',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_providers_lane_provider ON lane_providers(lane, provider);

    CREATE TABLE IF NOT EXISTS lane_capabilities (
      _id TEXT PRIMARY KEY,
      lane TEXT NOT NULL,
      providerId TEXT,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      inputSchema TEXT NOT NULL DEFAULT '{}',
      outputSchema TEXT NOT NULL DEFAULT '{}',
      permission TEXT NOT NULL DEFAULT 'auto',
      sideEffect TEXT,
      riskTier TEXT NOT NULL DEFAULT 'normal',
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_capabilities_name ON lane_capabilities(name);
    CREATE INDEX IF NOT EXISTS idx_lane_capabilities_lane ON lane_capabilities(lane, enabled);

    CREATE TABLE IF NOT EXISTS coo_routing_rules (
      _id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      intent TEXT NOT NULL,
      match_json TEXT NOT NULL DEFAULT '{}',
      constraints_json TEXT NOT NULL DEFAULT '{}',
      lane TEXT NOT NULL,
      capability TEXT NOT NULL,
      backend_policy TEXT NOT NULL DEFAULT 'lane_owned_first',
      model_posture TEXT NOT NULL DEFAULT 'mixed-local-first',
      risk_tier TEXT NOT NULL DEFAULT 'normal',
      approval_policy TEXT NOT NULL DEFAULT '{}',
      verification_policy TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coo_routing_enabled_priority ON coo_routing_rules(enabled, priority);
    CREATE INDEX IF NOT EXISTS idx_coo_routing_lane ON coo_routing_rules(lane, capability);

    CREATE TABLE IF NOT EXISTS coo_routing_rule_history (
      _id TEXT PRIMARY KEY,
      ruleId TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      actor TEXT NOT NULL DEFAULT 'hive',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coo_routing_history_rule ON coo_routing_rule_history(ruleId, createdAt);

    CREATE TABLE IF NOT EXISTS browser_sites (
      _id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      homeUrl TEXT NOT NULL,
      loginUrl TEXT,
      allowedDomains TEXT NOT NULL DEFAULT '[]',
      profileRef TEXT,
      authStrategy TEXT NOT NULL DEFAULT 'manual_session',
      status TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_browser_sites_status ON browser_sites(status);

    CREATE TABLE IF NOT EXISTS browser_credentials (
      _id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      credentialRef TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'keychain_password',
      accountLabel TEXT,
      allowedDomains TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'unknown',
      lastVerifiedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_credentials_ref ON browser_credentials(credentialRef);
    CREATE INDEX IF NOT EXISTS idx_browser_credentials_site ON browser_credentials(siteId);

    CREATE TABLE IF NOT EXISTS browser_readiness_probes (
      _id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      assertions_json TEXT NOT NULL DEFAULT '[]',
      requiresAuth INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_browser_readiness_probes_site ON browser_readiness_probes(siteId, enabled);

    CREATE TABLE IF NOT EXISTS browser_readiness_runs (
      _id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      probeId TEXT,
      status TEXT NOT NULL,
      color TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      traceRunId TEXT,
      startedAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_browser_readiness_runs_site ON browser_readiness_runs(siteId, startedAt);

    CREATE TABLE IF NOT EXISTS browser_trace_runs (
      _id TEXT PRIMARY KEY,
      siteId TEXT,
      workflowId TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      traceDir TEXT,
      startedAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_browser_trace_runs_site ON browser_trace_runs(siteId, startedAt);

    CREATE TABLE IF NOT EXISTS browser_trace_events (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      traceRunId TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      screenshotPath TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_browser_trace_events_run ON browser_trace_events(traceRunId, createdAt);`,

  // v19: COO route-to-execution audit trail. Append-only record of every
  // dispatch decision. No secrets: requestText is the operator's intent and the
  // bridge never resolves credential/cookie/Keychain material into a row.
  `CREATE TABLE IF NOT EXISTS coo_dispatch_audit (
      _id TEXT PRIMARY KEY,
      requestText TEXT NOT NULL,
      requestContext TEXT NOT NULL DEFAULT '{}',
      ruleId TEXT,
      ruleName TEXT,
      lane TEXT,
      capability TEXT,
      status TEXT NOT NULL,
      workItemId TEXT,
      reason TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coo_dispatch_audit_created ON coo_dispatch_audit(createdAt);`,

  // v20: link a dispatch audit row to the task it created (Browser Lane). Kept
  // separate from workItemId (the envelope id) so neither is overloaded.
  `ALTER TABLE coo_dispatch_audit ADD COLUMN taskId TEXT;`,

  // v21: generic Workflow Run Ledger — durable run state, events, artifacts, and
  // blockers for registered workflows. No secrets: artifact_json / metadata_json
  // are key-redacted before write by the store.
  `CREATE TABLE IF NOT EXISTS workflow_runs (
      _id TEXT PRIMARY KEY,
      workflowId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      title TEXT NOT NULL DEFAULT '',
      lane TEXT,
      capability TEXT,
      parentTaskId TEXT,
      draftId TEXT,
      childTaskId TEXT,
      currentStep TEXT,
      blocker TEXT,
      artifact_json TEXT NOT NULL DEFAULT '{}',
      runbook TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflowId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_draft ON workflow_runs(draftId);

    CREATE TABLE IF NOT EXISTS workflow_run_events (
      _id TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run ON workflow_run_events(runId, createdAt);`,

  // v22: workflow action handoffs — a run can durably PROPOSE a next workflow, which
  // an operator/model later executes explicitly. No secrets: suggested_inputs_json is
  // key-redacted by the store.
  `CREATE TABLE IF NOT EXISTS workflow_actions (
      _id TEXT PRIMARY KEY,
      sourceRunId TEXT NOT NULL,
      targetWorkflowId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      required_inputs_json TEXT NOT NULL DEFAULT '[]',
      suggested_inputs_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'proposed',
      resultRunId TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_actions_source ON workflow_actions(sourceRunId, createdAt);`,

  // v23: workflow review gate — durable review decisions on runs, and an artifact map
  // on actions so execution pulls the CURRENT (revised) source artifacts. Additive;
  // notes/values are secret-scrubbed by the store.
  `ALTER TABLE workflow_runs ADD COLUMN reviewDecision TEXT;
   ALTER TABLE workflow_runs ADD COLUMN reviewNote TEXT;
   ALTER TABLE workflow_runs ADD COLUMN reviewedAt TEXT;
   ALTER TABLE workflow_runs ADD COLUMN reviewedArtifacts_json TEXT;
   ALTER TABLE workflow_actions ADD COLUMN source_artifact_map_json TEXT;`,

  // v24: Browser Lane sites record the non-secret provider account/email the site
  // signs in as (Google/Microsoft SSO, or a Keychain account label). Metadata
  // only — never a password/cookie/token; secrets stay in macOS Keychain.
  `ALTER TABLE browser_sites ADD COLUMN providerAccount TEXT;`,

  // v25: Terminal Lane control-plane schema. Secrets never live here:
  // terminal_credentials stores only Keychain credentialRef metadata.
  `CREATE TABLE IF NOT EXISTS terminal_profiles (
      _id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      kind TEXT NOT NULL,
      host TEXT,
      user TEXT,
      port INTEGER,
      shell TEXT,
      cwd TEXT,
      credentialRef TEXT,
      openCommand TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_terminal_profiles_kind ON terminal_profiles(kind);
    CREATE INDEX IF NOT EXISTS idx_terminal_profiles_status ON terminal_profiles(status);

    CREATE TABLE IF NOT EXISTS terminal_credentials (
      _id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      credentialRef TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'keychain_secret',
      accountLabel TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      lastVerifiedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_credentials_ref ON terminal_credentials(credentialRef);
    CREATE INDEX IF NOT EXISTS idx_terminal_credentials_profile ON terminal_credentials(profileId);

    CREATE TABLE IF NOT EXISTS terminal_readiness_probes (
      _id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_terminal_readiness_probes_profile ON terminal_readiness_probes(profileId, enabled);

    CREATE TABLE IF NOT EXISTS terminal_readiness_runs (
      _id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      probeId TEXT,
      status TEXT NOT NULL,
      color TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      startedAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_terminal_readiness_runs_profile ON terminal_readiness_runs(profileId, startedAt);

    CREATE TABLE IF NOT EXISTS terminal_session_audit (
      _id TEXT PRIMARY KEY,
      profileId TEXT,
      sessionId TEXT,
      event TEXT NOT NULL,
      command TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_terminal_session_audit_created ON terminal_session_audit(createdAt);
    CREATE INDEX IF NOT EXISTS idx_terminal_session_audit_profile ON terminal_session_audit(profileId, createdAt);`,

  // v26: Terminal Lane honest auth model. authMethod replaces the implicit
  // "kind+credentialRef" guesswork; keyPath stores an SSH identity-file PATH
  // (metadata only — never a secret). Existing rows default to 'local'.
  `ALTER TABLE terminal_profiles ADD COLUMN authMethod TEXT NOT NULL DEFAULT 'local';
   ALTER TABLE terminal_profiles ADD COLUMN keyPath TEXT;`,

  // v27–v28: Work Packages + Flight Loops removed 2026-07-06. Broad prompts now
  // dispatch as a single task with workflow:"work" and the frontier coding harness
  // self-plans via Superpowers — no decomposition/DAG tables. Historical rows (if
  // any) are left untouched; nothing creates or queries these tables anymore.

  // v29: Flash Lane — conversational agent loop sessions and turns. Per-channel-peer
  // session scoping: same iMessage sender resumes their session; console + voice
  // share one operator session per profile. Feedback stored in artifactsJson column.
  `CREATE TABLE IF NOT EXISTS flash_sessions (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      peer TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastActiveAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_flash_sessions_channel_peer ON flash_sessions(channel, peer, lastActiveAt);
    CREATE INDEX IF NOT EXISTS idx_flash_sessions_last_active ON flash_sessions(lastActiveAt);

    CREATE TABLE IF NOT EXISTS flash_turns (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      toolCallsJson TEXT,
      artifactsJson TEXT,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_flash_turns_session ON flash_turns(sessionId, ts);`,

  // v30: Flash Lane learning loop — track which sessions have been distilled so the
  // scheduler doesn't re-distill already-processed sessions across daemon restarts.
  `ALTER TABLE flash_sessions ADD COLUMN distilledAt TEXT;`,

  // v31: Credential vault ref index — metadata only; actual secrets live in the macOS
  // Keychain under service "hivematrix-vault", account "<scope>/<name>".
  `CREATE TABLE IF NOT EXISTS vault_refs (
    scope     TEXT NOT NULL,
    name      TEXT NOT NULL,
    label     TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (scope, name)
  );
  CREATE INDEX IF NOT EXISTS idx_vault_refs_scope ON vault_refs(scope);`,

  // v32: Terminal Lane per-server access mode (readwrite default | readonly).
  // App-side enforcement classifies commands against editable allow/block lists;
  // the daemon only stores/syncs the mode.
  `ALTER TABLE terminal_profiles ADD COLUMN accessMode TEXT NOT NULL DEFAULT 'readwrite';`,
];

// ------------------------------------------------------------------
// Open / initialise the database
// ------------------------------------------------------------------
function openDb(): Database.Database {
  const db = new Database(resolveDbPath());

  // Enable WAL mode for concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

/**
 * Apply pending migrations, each atomically with its user_version bump — a
 * crash mid-migration must not leave half a schema behind or re-run an
 * already-applied migration on the next start. Exported for tests.
 */
export function runMigrations(db: Database.Database, migrations: readonly string[] = MIGRATIONS): void {
  const currentVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  for (let i = currentVersion; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function getDb(): Database.Database {
  if (!g.__hivematrixSqlite) {
    g.__hivematrixSqlite = openDb();
  }
  return g.__hivematrixSqlite;
}

export default getDb;

/**
 * Test-only: close and clear the singleton so the next getDb() reopens against
 * the current HIVEMATRIX_DB_PATH/HOME. Not for production use.
 */
export function _resetDbForTests(): void {
  try { g.__hivematrixSqlite?.close(); } catch { /* ignore */ }
  delete g.__hivematrixSqlite;
}

export function generateId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

// ------------------------------------------------------------------
// TaskStore — drop-in replacement for Mongoose Task model
// ------------------------------------------------------------------

interface TaskRow {
  _id: string;
  title: string;
  description: string;
  project: string;
  projectPath: string;
  status: string;
  reviewState: string | null;
  position: number;
  agentPid: number | null;
  sessionId: string | null;
  resumeSessionId: string | null;
  source: string;
  executor: string;
  workflow: string;
  workflowStepIndex: number;
  model: string | null;
  profile: string | null;
  nextStep: string | null;
  parentTaskId: string | null;
  centralTaskId: string | null;
  directiveId: string | null;
  delayUntil: string | null;
  delayReason: string | null;
  worktreeName: string | null;
  launchCommand: string | null;
  agentType: string;
  thinkingMode: string;
  brainSelection: string;
  dependsOn: string;
  output: string;
  logs: string;
  turns: string;
  approvals: string;
  comments: string;
  error: string | null;
  timeoutMinutes: number;
  maxBudgetUsd: number;
  completedBy: string | null;
  proverType: string | null;
  completionNote: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskDoc = Omit<TaskRow, "output" | "logs" | "turns" | "approvals" | "comments" | "dependsOn" | "brainSelection"> & {
  output: Record<string, unknown>;
  logs: Array<Record<string, unknown>>;
  turns: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  dependsOn: string[];
  brainSelection: ReturnType<typeof normalizeBrainSelection>;
  [key: string]: unknown;
};

function rowToTask(row: TaskRow): TaskDoc {
  return {
    ...row,
    output: JSON.parse(row.output || "{}"),
    logs: JSON.parse(row.logs || "[]"),
    turns: JSON.parse(row.turns || "[]"),
    approvals: JSON.parse(row.approvals || "[]"),
    comments: JSON.parse(row.comments || "[]"),
    dependsOn: JSON.parse(row.dependsOn || "[]"),
    brainSelection: normalizeBrainSelection(JSON.parse(row.brainSelection || "{}")),
  };
}

function buildWhere(query: Record<string, unknown>): { where: string; params: unknown[] } {
  if (Object.keys(query).length === 0) return { where: "", params: [] };

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(query)) {
    if (key === "$or") {
      const orClauses = (value as Record<string, unknown>[]).map((clause) => {
        const sub = buildWhere(clause);
        params.push(...sub.params);
        return `(${sub.where.replace(" WHERE ", "")})`;
      });
      conditions.push(`(${orClauses.join(" OR ")})`);
    } else if (key === "$and") {
      const andClauses = (value as Record<string, unknown>[]).map((clause) => {
        const sub = buildWhere(clause);
        params.push(...sub.params);
        return `(${sub.where.replace(" WHERE ", "")})`;
      });
      conditions.push(`(${andClauses.join(" AND ")})`);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if (op.$in) {
        const vals = op.$in as unknown[];
        conditions.push(`${key} IN (${vals.map(() => "?").join(", ")})`);
        params.push(...vals);
      } else if (op.$nin) {
        const vals = op.$nin as unknown[];
        conditions.push(`${key} NOT IN (${vals.map(() => "?").join(", ")})`);
        params.push(...vals);
      } else if (op.$ne !== undefined) {
        if (op.$ne === null) {
          conditions.push(`${key} IS NOT NULL`);
        } else {
          conditions.push(`${key} != ?`);
          params.push(op.$ne);
        }
      } else if (op.$exists !== undefined) {
        conditions.push(op.$exists ? `${key} IS NOT NULL` : `${key} IS NULL`);
      } else if (op.$lte !== undefined) {
        conditions.push(`${key} <= ?`);
        params.push(op.$lte);
      } else if (op.$gte !== undefined) {
        conditions.push(`${key} >= ?`);
        params.push(op.$gte);
      } else if (op.$gt !== undefined) {
        conditions.push(`${key} > ?`);
        params.push(op.$gt);
      } else if (op.$lt !== undefined) {
        conditions.push(`${key} < ?`);
        params.push(op.$lt);
      }
    } else if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else {
      conditions.push(`${key} = ?`);
      params.push(value);
    }
  }

  return { where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "", params };
}

export const Task = {
  find(query: Record<string, unknown> = {}) {
    const db = getDb();
    const { where, params } = buildWhere(query);
    const sql = `SELECT * FROM tasks${where}`;
    let sortClause = "";
    let limitVal = 0;
    const chain = {
      sort(sort: Record<string, number>) {
        sortClause = ` ORDER BY ${Object.entries(sort).map(([k, v]) => `${k} ${v === 1 ? "ASC" : "DESC"}`).join(", ")}`;
        return chain;
      },
      limit(n: number) { limitVal = n; return chain; },
       
      select(_fields?: string) { return chain; },
      lean() { return chain; },
      then<TResult1 = TaskDoc[], TResult2 = never>(
        resolve?: ((val: TaskDoc[]) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((err: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        try {
          let finalSql = sql + sortClause;
          if (limitVal > 0) finalSql += ` LIMIT ${limitVal}`;
          const rows = db.prepare(finalSql).all(...params) as TaskRow[];
          const result = rows.map(rowToTask);
          return Promise.resolve(resolve ? resolve(result) : result as unknown as TResult1);
        } catch (err) {
          if (reject) return Promise.resolve(reject(err));
          return Promise.reject(err);
        }
      },
    };
    return chain;
  },

  findOne(query: Record<string, unknown> = {}) {
    const db = getDb();
    const { where, params } = buildWhere(query);
    let sortClause = "";
    const chain = {
      sort(sort: Record<string, number>) {
        sortClause = ` ORDER BY ${Object.entries(sort).map(([k, v]) => `${k} ${v === 1 ? "ASC" : "DESC"}`).join(", ")}`;
        return chain;
      },
       
      select(_fields?: string) { return chain; },
      lean() { return chain; },
      then<TResult1 = TaskDoc | null, TResult2 = never>(
        resolve?: ((val: TaskDoc | null) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((err: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        try {
          const row = db.prepare(`SELECT * FROM tasks${where}${sortClause} LIMIT 1`).get(...params) as TaskRow | undefined;
          const result = row ? rowToTask(row) : null;
          return Promise.resolve(resolve ? resolve(result) : result as unknown as TResult1);
        } catch (err) {
          if (reject) return Promise.resolve(reject(err));
          return Promise.reject(err);
        }
      },
    };
    return chain;
  },

  async findById(id: string): Promise<TaskDoc | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  },

  async findByIdAndUpdate(id: string, updates: Record<string, unknown>): Promise<TaskDoc | null> {
    const db = getDb();

    if (updates.$push) {
      const pushOps = updates.$push as Record<string, unknown>;
      for (const [field, value] of Object.entries(pushOps)) {
        if (["logs", "turns", "approvals", "comments"].includes(field)) {
          const current = db.prepare(`SELECT ${field} FROM tasks WHERE _id = ?`).get(id) as Record<string, string> | undefined;
          if (current) {
            const arr = JSON.parse(current[field] || "[]");
            arr.push(value);
            db.prepare(`UPDATE tasks SET ${field} = ?, updatedAt = datetime('now') WHERE _id = ?`).run(JSON.stringify(arr), id);
          }
        }
      }
      delete updates.$push;
    }

    if (updates.$set) {
      const setOps = updates.$set as Record<string, unknown>;
      for (const [key, value] of Object.entries(setOps)) {
        if (key.startsWith("approvals.")) {
          const current = db.prepare("SELECT approvals FROM tasks WHERE _id = ?").get(id) as { approvals: string } | undefined;
          if (current) {
            const approvals = JSON.parse(current.approvals || "[]");
            for (const a of approvals) {
              if (!a.decision) {
                if (key.includes("decision")) a.decision = value;
                if (key.includes("decidedVia")) a.decidedVia = setOps["approvals.$[elem].decidedVia"];
              }
            }
            db.prepare("UPDATE tasks SET approvals = ?, updatedAt = datetime('now') WHERE _id = ?").run(JSON.stringify(approvals), id);
          }
        }
      }
      delete updates.$set;
      if (Object.keys(updates).length === 0) {
        const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(id) as TaskRow | undefined;
        return row ? rowToTask(row) : null;
      }
    }

    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith("$") || v === undefined) continue;
      clean[k] = v;
    }

    if (Object.keys(clean).length > 0) {
      if (clean.output && typeof clean.output === "object") clean.output = JSON.stringify(clean.output);
      if (clean.logs && Array.isArray(clean.logs)) clean.logs = JSON.stringify(clean.logs);
      if (clean.turns && Array.isArray(clean.turns)) clean.turns = JSON.stringify(clean.turns);
      if (clean.approvals && Array.isArray(clean.approvals)) clean.approvals = JSON.stringify(clean.approvals);
      if (clean.comments && Array.isArray(clean.comments)) clean.comments = JSON.stringify(clean.comments);
      if (clean.dependsOn && Array.isArray(clean.dependsOn)) clean.dependsOn = JSON.stringify(clean.dependsOn);
      if (clean.brainSelection && typeof clean.brainSelection === "object") {
        clean.brainSelection = JSON.stringify(normalizeBrainSelection(clean.brainSelection));
      }

      const setClauses = [...Object.keys(clean).map((k) => `${k} = ?`), "updatedAt = datetime('now')"];
      db.prepare(`UPDATE tasks SET ${setClauses.join(", ")} WHERE _id = ?`).run(...Object.values(clean), id);
    }

    const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  },

  async findOneAndUpdate(query: Record<string, unknown>, updates: Record<string, unknown>, opts?: { sort?: Record<string, number> }) {
    const db = getDb();
    const { where, params } = buildWhere(query);
    let sql = `SELECT _id FROM tasks${where}`;
    if (opts?.sort) {
      sql += ` ORDER BY ${Object.entries(opts.sort).map(([k, v]) => `${k} ${v === 1 ? "ASC" : "DESC"}`).join(", ")}`;
    }
    sql += " LIMIT 1";
    const row = db.prepare(sql).get(...params) as { _id: string } | undefined;
    if (!row) return null;
    return Task.findByIdAndUpdate(row._id, updates);
  },

  async create(data: Record<string, unknown>): Promise<TaskDoc> {
    const db = getDb();
    const id = (data._id as string) || generateId();
    const now = new Date().toISOString();
    const fields: Record<string, unknown> = {
      _id: id,
      title: data.title,
      description: data.description,
      project: data.project,
      projectPath: data.projectPath,
      status: data.status ?? "backlog",
      reviewState: data.reviewState ?? null,
      position: data.position ?? 0,
      agentPid: data.agentPid ?? null,
      sessionId: data.sessionId ?? null,
      resumeSessionId: data.resumeSessionId ?? null,
      source: data.source ?? "dashboard",
      executor: data.executor ?? "agent",
      workflow: data.workflow ?? "standalone",
      workflowStepIndex: data.workflowStepIndex ?? 0,
      model: data.model ?? null,
      profile: data.profile ?? null,
      nextStep: data.nextStep ?? null,
      parentTaskId: data.parentTaskId ?? null,
      centralTaskId: data.centralTaskId ?? null,
      directiveId: data.directiveId ?? null,
      delayUntil: data.delayUntil ?? null,
      delayReason: data.delayReason ?? null,
      worktreeName: data.worktreeName ?? null,
      launchCommand: data.launchCommand ?? null,
      agentType: data.agentType ?? "auto",
      thinkingMode: data.thinkingMode ?? "auto",
      brainSelection: JSON.stringify(normalizeBrainSelection(data.brainSelection)),
      dependsOn: JSON.stringify(data.dependsOn ?? []),
      output: JSON.stringify(data.output ?? {}),
      logs: JSON.stringify(data.logs ?? []),
      turns: JSON.stringify(data.turns ?? []),
      approvals: JSON.stringify(data.approvals ?? []),
      comments: JSON.stringify(data.comments ?? []),
      error: data.error ?? null,
      timeoutMinutes: data.timeoutMinutes ?? 60,
      maxBudgetUsd: data.maxBudgetUsd ?? 5.0,
      completedBy: data.completedBy ?? null,
      proverType: data.proverType ?? null,
      completionNote: data.completionNote ?? null,
      assignedAt: data.assignedAt ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
    const columns = Object.keys(fields);
    db.prepare(`INSERT INTO tasks (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(fields));
    const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(id) as TaskRow;
    return rowToTask(row);
  },

  async findByIdAndDelete(id: string) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(id) as TaskRow | undefined;
    if (!row) return null;
    db.prepare("DELETE FROM tasks WHERE _id = ?").run(id);
    return rowToTask(row);
  },

  async deleteMany(query: Record<string, unknown>) {
    const db = getDb();
    const { where, params } = buildWhere(query);
    const result = db.prepare(`DELETE FROM tasks${where}`).run(...params);
    return { deletedCount: result.changes };
  },

  async countDocuments(query: Record<string, unknown>): Promise<number> {
    const db = getDb();
    const { where, params } = buildWhere(query);
    const row = db.prepare(`SELECT COUNT(*) as count FROM tasks${where}`).get(...params) as { count: number };
    return row.count;
  },

  async updateMany(query: Record<string, unknown>, updates: Record<string, unknown>) {
    const db = getDb();
    const { where, params } = buildWhere(query);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith("$") || v === undefined) continue;
      clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return { modifiedCount: 0 };
    if (clean.output && typeof clean.output === "object") clean.output = JSON.stringify(clean.output);
    if (clean.brainSelection && typeof clean.brainSelection === "object") {
      clean.brainSelection = JSON.stringify(normalizeBrainSelection(clean.brainSelection));
    }
    const setClauses = [...Object.keys(clean).map((k) => `${k} = ?`), "updatedAt = datetime('now')"];
    const result = db.prepare(`UPDATE tasks SET ${setClauses.join(", ")}${where}`).run(...Object.values(clean), ...params);
    return { modifiedCount: result.changes };
  },

  countByStatus(): Record<string, number> {
    const db = getDb();
    const rows = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all() as { status: string; count: number }[];
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = row.count;
    return result;
  },
};
