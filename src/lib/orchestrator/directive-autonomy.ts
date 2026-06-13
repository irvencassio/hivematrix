import { existsSync, readFileSync } from "fs";
import { promises as fs } from "fs";
import { join, resolve } from "path";

export interface DirectiveCriterionRef {
  _id: string;
  description: string;
}

export interface DirectivePlanTask {
  title: string;
  description: string;
  agentType: string;
  dependsOn: number[];
  criterionIds: string[];
  goalIndex: number | null;
}

export interface DirectivePlan {
  tasks: DirectivePlanTask[];
}

export interface DirectiveReviewFinding {
  task: string;
  assessment: string;
  notes: string;
}

export interface DirectiveCorrectiveTask {
  title: string;
  description: string;
  agentType: string;
  criterionIds: string[];
}

export interface DirectiveReview {
  status: "pass" | "partial" | "fail";
  findings: DirectiveReviewFinding[];
  gaps: string[];
  correctiveTasks: DirectiveCorrectiveTask[];
  summary: string;
}

export interface DirectivePlaybookDelta {
  scope: string;
  rule: string;
  reason?: string;
  confidence?: string;
}

export interface DirectiveAccessLedgerEntry {
  system: string;
  status: string;
  notes?: string;
}

export interface DirectiveRetrospective {
  lessonsLearned: string[];
  whatWorked: string[];
  whatDidnt: string[];
  followUpDirectives: Array<{ title: string; goal: string }>;
  overallAssessment: string;
  playbookDeltas: DirectivePlaybookDelta[];
  accessLedger: DirectiveAccessLedgerEntry[];
}

export interface DirectiveRetrospectiveLearningContext {
  brainRootDir: string;
  project: string;
  runId: string;
  directiveGoal: string;
  dateStr: string;
}

export interface DirectiveRetrospectiveLearningResult {
  roleFiles: string[];
  projectFiles: string[];
  accessLedgerFile: string | null;
}

export type DirectiveCheckpointLevel = "none" | "plan" | "full";

export interface DirectiveCheckpointPolicy {
  level: DirectiveCheckpointLevel;
}

const CHECKPOINT_LEVELS: ReadonlySet<string> = new Set(["none", "plan", "full"]);

/**
 * Parse the directive's `approvalPolicy` JSON column into a checkpoint policy.
 *
 * Accepts the terse `{ "checkpoint": "plan" }` and the nested
 * `{ "checkpoint": { "level": "plan" } }` shapes. Anything missing, malformed,
 * or unrecognized resolves to `none` (fully autonomous) — the policy fails open
 * to "no gate" so a bad config never bricks a directive, while the engine fails
 * closed on an *active* checkpoint that cannot be resolved.
 */
export function parseDirectiveCheckpointPolicy(approvalPolicyJson: string | null | undefined): DirectiveCheckpointPolicy {
  if (!approvalPolicyJson) return { level: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(approvalPolicyJson);
  } catch {
    return { level: "none" };
  }
  if (!parsed || typeof parsed !== "object") return { level: "none" };
  const raw = (parsed as Record<string, unknown>).checkpoint;
  let level: unknown = raw;
  if (raw && typeof raw === "object") level = (raw as Record<string, unknown>).level;
  if (typeof level === "string" && CHECKPOINT_LEVELS.has(level)) {
    return { level: level as DirectiveCheckpointLevel };
  }
  return { level: "none" };
}

export function extractDirectiveJson<T = unknown>(text: string): { parsed: T | null; raw: string | null; error: string | null } {
  let fenceError: string | null = null;
  const fenceMatch = text.match(/```json\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const raw = fenceMatch[1].trim();
      return { parsed: JSON.parse(raw) as T, raw, error: null };
    } catch (err) {
      fenceError = `JSON parse error in fenced block: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const raw = objectMatch[0];
      return { parsed: JSON.parse(raw) as T, raw, error: null };
    } catch (err) {
      const rawError = `JSON parse error in raw block: ${err instanceof Error ? err.message : String(err)}`;
      return { parsed: null, raw: objectMatch[0], error: fenceError ? `${fenceError}; ${rawError}` : rawError };
    }
  }

  return { parsed: null, raw: null, error: fenceError ?? "No JSON block found in directive autonomy output" };
}

export function normalizeDirectivePlan(input: unknown, criteria: DirectiveCriterionRef[]): { plan: DirectivePlan | null; error: string | null } {
  const raw = input as { tasks?: unknown };
  if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    return { plan: null, error: "Directive plan must include a non-empty tasks array" };
  }

  const tasks: DirectivePlanTask[] = [];
  raw.tasks.forEach((taskUnknown, index) => {
    const task = taskUnknown as Record<string, unknown>;
    const title = nonEmptyString(task.title) ?? `Directive task ${index + 1}`;
    const description = nonEmptyString(task.description) ?? title;
    const agentType = nonEmptyString(task.agentType) ?? "general";
    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn
        .map((n) => typeof n === "number" ? n : Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < index)
      : [];

    tasks.push({
      title,
      description,
      agentType,
      dependsOn: Array.from(new Set(dependsOn)),
      criterionIds: resolveCriterionIds(task.criterionRefs, criteria),
      goalIndex: typeof task.goalIndex === "number" && Number.isInteger(task.goalIndex) ? task.goalIndex : null,
    });
  });

  return { plan: { tasks }, error: null };
}

export function parseDirectivePlanOutput(text: string, criteria: DirectiveCriterionRef[]): { plan: DirectivePlan | null; error: string | null; raw: string | null } {
  const extracted = extractDirectiveJson(text);
  if (!extracted.parsed) return { plan: null, error: extracted.error, raw: extracted.raw };
  const normalized = normalizeDirectivePlan(extracted.parsed, criteria);
  return { ...normalized, raw: extracted.raw };
}

export function parseDirectiveReviewOutput(text: string, criteria: DirectiveCriterionRef[]): { review: DirectiveReview | null; error: string | null; raw: string | null } {
  const extracted = extractDirectiveJson<Record<string, unknown>>(text);
  if (!extracted.parsed) return { review: null, error: extracted.error, raw: extracted.raw };

  const statusValue = String(extracted.parsed.status ?? "partial");
  const status = statusValue === "pass" || statusValue === "fail" || statusValue === "partial" ? statusValue : "partial";
  const correctiveTasks = Array.isArray(extracted.parsed.correctiveTasks)
    ? extracted.parsed.correctiveTasks.map((taskUnknown, index) => {
      const task = taskUnknown as Record<string, unknown>;
      return {
        title: nonEmptyString(task.title) ?? `Corrective task ${index + 1}`,
        description: nonEmptyString(task.description) ?? nonEmptyString(task.title) ?? `Corrective task ${index + 1}`,
        agentType: nonEmptyString(task.agentType) ?? "general",
        criterionIds: resolveCriterionIds(task.criterionRefs, criteria),
      };
    })
    : [];

  return {
    raw: extracted.raw,
    error: null,
    review: {
      status,
      findings: normalizeReviewFindings(extracted.parsed.findings),
      gaps: normalizeStringArray(extracted.parsed.gaps),
      correctiveTasks,
      summary: nonEmptyString(extracted.parsed.summary) ?? "",
    },
  };
}

export function parseDirectiveRetrospectiveOutput(text: string): { retrospective: DirectiveRetrospective | null; error: string | null; raw: string | null } {
  const extracted = extractDirectiveJson<Record<string, unknown>>(text);
  if (!extracted.parsed) return { retrospective: null, error: extracted.error, raw: extracted.raw };

  return {
    raw: extracted.raw,
    error: null,
    retrospective: {
      lessonsLearned: normalizeStringArray(extracted.parsed.lessonsLearned),
      whatWorked: normalizeStringArray(extracted.parsed.whatWorked),
      whatDidnt: normalizeStringArray(extracted.parsed.whatDidnt),
      followUpDirectives: normalizeFollowUps(extracted.parsed.followUpDirectives),
      overallAssessment: nonEmptyString(extracted.parsed.overallAssessment) ?? "",
      playbookDeltas: normalizePlaybookDeltas(extracted.parsed.playbookDeltas),
      accessLedger: normalizeAccessLedger(extracted.parsed.accessLedger),
    },
  };
}

export async function writeDirectiveRetrospectiveLearning(
  retrospective: DirectiveRetrospective,
  ctx: DirectiveRetrospectiveLearningContext,
): Promise<DirectiveRetrospectiveLearningResult> {
  const root = resolve(ctx.brainRootDir);
  const playbooks = resolve(root, "hive", "playbooks");
  const roles = join(playbooks, "roles");
  const projects = join(playbooks, "projects");
  await fs.mkdir(roles, { recursive: true });
  await fs.mkdir(projects, { recursive: true });

  const roleFiles: string[] = [];
  const projectFiles: string[] = [];
  const buckets = new Map<string, DirectivePlaybookDelta[]>();

  for (const delta of retrospective.playbookDeltas) {
    const target = playbookTarget(delta.scope, ctx.project, roles, projects);
    if (!target) continue;
    const list = buckets.get(target) ?? [];
    list.push(delta);
    buckets.set(target, list);
  }

  for (const [path, deltas] of buckets.entries()) {
    assertInside(root, path);
    const existed = existsSync(path);
    const seed = existed ? "" : `# Playbook: ${basenameNoExt(path)}\n\nAccumulated rules distilled from directive retrospectives.\n`;
    const block = `\n\n## ${ctx.dateStr} - ${ctx.directiveGoal} (${ctx.runId})\n`
      + deltas.map((delta) => {
        const confidence = delta.confidence ? ` *(confidence: ${delta.confidence})*` : "";
        const reason = delta.reason ? `\n  - Why: ${delta.reason}` : "";
        return `- ${delta.rule}${confidence}${reason}`;
      }).join("\n")
      + "\n";
    await fs.appendFile(path, seed + block);
    if (path.includes(`${join("hive", "playbooks", "roles")}/`) || path.includes("/roles/")) roleFiles.push(path);
    else projectFiles.push(path);
  }

  const accessLedgerFile = retrospective.accessLedger.length > 0
    ? await writeAccessLedger(projects, root, ctx, retrospective.accessLedger)
    : null;

  return { roleFiles, projectFiles, accessLedgerFile };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(nonEmptyString).filter((s): s is string => !!s);
}

function normalizeReviewFindings(value: unknown): DirectiveReviewFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const rec = item as Record<string, unknown>;
    return {
      task: nonEmptyString(rec?.task) ?? "",
      assessment: nonEmptyString(rec?.assessment) ?? "",
      notes: nonEmptyString(rec?.notes) ?? "",
    };
  });
}

function resolveCriterionIds(refs: unknown, criteria: DirectiveCriterionRef[]): string[] {
  if (!Array.isArray(refs)) return [];
  const ids = new Set<string>();
  for (const rawRef of refs) {
    const ref = nonEmptyString(rawRef);
    if (!ref) continue;
    const exact = criteria.find((c) => c._id === ref || c.description === ref);
    if (exact) {
      ids.add(exact._id);
      continue;
    }
    const lowered = ref.toLowerCase();
    const fuzzy = criteria.find((c) => c.description.toLowerCase().includes(lowered) || lowered.includes(c.description.toLowerCase()));
    if (fuzzy) ids.add(fuzzy._id);
  }
  return Array.from(ids);
}

function normalizeFollowUps(value: unknown): Array<{ title: string; goal: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const rec = item as Record<string, unknown>;
    const title = nonEmptyString(rec.title) ?? `Follow-up directive ${index + 1}`;
    return { title, goal: nonEmptyString(rec.goal) ?? nonEmptyString(rec.objective) ?? title };
  });
}

function normalizePlaybookDeltas(value: unknown): DirectivePlaybookDelta[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const rec = item as Record<string, unknown>;
    const scope = nonEmptyString(rec.scope);
    const rule = nonEmptyString(rec.rule);
    if (!scope || !rule) return [];
    return [{
      scope,
      rule,
      reason: nonEmptyString(rec.reason) ?? undefined,
      confidence: nonEmptyString(rec.confidence) ?? undefined,
    }];
  });
}

function normalizeAccessLedger(value: unknown): DirectiveAccessLedgerEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const rec = item as Record<string, unknown>;
    const system = nonEmptyString(rec.system);
    const status = nonEmptyString(rec.status);
    if (!system || !status) return [];
    return [{ system, status, notes: nonEmptyString(rec.notes) ?? undefined }];
  });
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
}

function playbookTarget(scope: string, project: string, rolesDir: string, projectsDir: string): string | null {
  const lowered = scope.toLowerCase().trim();
  if (lowered.startsWith("role:")) {
    const role = lowered.slice("role:".length).trim();
    return role ? join(rolesDir, `${slugify(role)}.md`) : null;
  }
  if (lowered.startsWith("project:")) {
    const scopedProject = lowered.slice("project:".length).trim();
    return scopedProject ? join(projectsDir, `${slugify(scopedProject)}.md`) : null;
  }
  if (lowered === "project") return join(projectsDir, `${slugify(project)}.md`);
  return lowered ? join(rolesDir, `${slugify(lowered)}.md`) : null;
}

function basenameNoExt(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? "playbook";
}

function assertInside(root: string, path: string): void {
  const resolved = resolve(path);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`Refusing to write outside brain root: ${path}`);
  }
}

async function writeAccessLedger(
  projectsDir: string,
  root: string,
  ctx: DirectiveRetrospectiveLearningContext,
  entries: DirectiveAccessLedgerEntry[],
): Promise<string> {
  const path = join(projectsDir, `${slugify(ctx.project)}-access.md`);
  assertInside(root, path);

  const table = new Map<string, DirectiveAccessLedgerEntry>();
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    const rows = existing.split("\n").filter((line) => line.startsWith("| ") && !line.includes("---"));
    for (const row of rows.slice(1)) {
      const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
      if (cells.length >= 3) table.set(cells[0], { system: cells[0], status: cells[1], notes: cells[2] });
    }
  }

  for (const entry of entries) table.set(entry.system, entry);

  const header = `# Access Ledger: ${ctx.project}\n\nRead before planning tasks; do not re-discover known credential/setup status.\n\n`;
  const tableRows = Array.from(table.values()).map((entry) =>
    `| ${escapeTable(entry.system)} | ${escapeTable(entry.status)} | ${escapeTable(entry.notes ?? "")} | ${ctx.dateStr} |`
  );
  const history = `\n\n## ${ctx.dateStr} - ${ctx.directiveGoal} (${ctx.runId})\n`
    + entries.map((entry) => `- ${entry.system}: ${entry.status}${entry.notes ? ` - ${entry.notes}` : ""}`).join("\n")
    + "\n";
  await fs.writeFile(path, header + "| System | Status | Notes | Last Updated |\n|---|---|---|---|\n" + tableRows.join("\n") + history);
  return path;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
