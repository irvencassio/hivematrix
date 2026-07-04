import { existsSync } from "fs";
import { promises as fs } from "fs";
import { join } from "path";
import {
  brainDocPolicyText,
  configuredBrainRootDir,
  defaultBrainRootDir,
  normalizeBrainRootDir,
  shortenHome,
} from "@/lib/brain/settings";

const DEFAULT_SECTION_MAX_CHARS = 2_500;
const DEFAULT_BUNDLE_MAX_CHARS = 12_000;

// The brain root commonly lives on a cloud mount (e.g. ~/_GD → Google Drive).
// A synchronous read of a dehydrated cloud file blocks the daemon's main thread
// on open() indefinitely. All brain reads MUST be async (so open() runs on the
// libuv threadpool, not the event loop) AND time-bounded (so a stalled Drive
// read fails gracefully instead of stalling agent spawn).
const BRAIN_READ_TIMEOUT_MS = 3_000;

async function readWithTimeout(path: string, timeoutMs = BRAIN_READ_TIMEOUT_MS): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface BrainMemoryBundleOptions {
  project?: string;
  bee?: string;
  role?: string;
  domain?: string;
  brainRootDir?: string;
  bundleMaxChars?: number;
  sectionMaxChars?: number;
  recapMaxChars?: number;
  recapLimit?: number;
  canonicalProject?: string;
}

type ReadMode = "head" | "tail";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getBrainRootDir(override?: string): string | null {
  if (override) return normalizeBrainRootDir(override);
  return configuredBrainRootDir();
}

function scaffoldRootDisplay(brainRootDir?: string): string {
  return shortenHome(getBrainRootDir(brainRootDir) ?? defaultBrainRootDir());
}

export function hiveProjectBrainDir(brainRootDir?: string): string {
  return join(getBrainRootDir(brainRootDir) ?? defaultBrainRootDir(), "projects", "hive");
}

export function hiveMissionRecapsDir(brainRootDir?: string): string {
  return join(getBrainRootDir(brainRootDir) ?? defaultBrainRootDir(), "sources", "missions", "recaps");
}

function legacyPlaybooksDir(brainRootDir?: string): string {
  return join(getBrainRootDir(brainRootDir) ?? defaultBrainRootDir(), "hive", "playbooks");
}

function laneSlugForCompatibilityId(id: string): string {
  const slug = slugify(id);
  const aliases: Record<string, string> = {
    authbee: "browser-session",
    brainbee: "memory",
    browserbee: "browser",
    computerbee: "desktop",
    cronbee: "scheduler",
    desktopbee: "desktop",
    inventorbee: "capability-design",
    mailbee: "mail",
    managerbee: "manager",
    messagebee: "message",
    termbee: "terminal",
    webbee: "browser",
  };
  return aliases[slug] ?? slug.replace(/-?bee$/, "");
}

async function boundedRead(path: string, maxChars: number, mode: ReadMode = "head"): Promise<string> {
  const raw = await readWithTimeout(path);
  if (raw == null) return ""; // missing, unreadable, or timed out (cloud stall)
  const content = raw.trim();
  if (content.length <= maxChars) return content;
  return mode === "tail" ? content.slice(-maxChars) : content.slice(0, maxChars);
}

function section(title: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return `### ${title}\n${trimmed}`;
}

function readLegacyRolePlaybook(role: string, brainRootDir: string, maxChars: number): Promise<string> {
  return boundedRead(join(legacyPlaybooksDir(brainRootDir), "roles", `${slugify(role)}.md`), maxChars, "tail");
}

function readLegacyProjectPlaybook(project: string, brainRootDir: string, maxChars: number): Promise<string> {
  return boundedRead(join(legacyPlaybooksDir(brainRootDir), "projects", `${slugify(project)}.md`), maxChars, "tail");
}

function readLegacyAccessLedger(project: string, brainRootDir: string, maxChars: number): Promise<string> {
  return boundedRead(
    join(legacyPlaybooksDir(brainRootDir), "projects", `${slugify(project)}-access.md`),
    maxChars,
    "tail"
  );
}

async function readLanePlaybook(projectDir: string, id: string, maxChars: number): Promise<string> {
  const legacyId = slugify(id);
  const lane = laneSlugForCompatibilityId(id);
  const primary = await boundedRead(join(projectDir, "lanes", `${lane}.md`), maxChars, "head");
  if (primary) return primary;
  return boundedRead(join(projectDir, "bees", `${legacyId}.md`), maxChars, "head");
}

async function readDomainPlaybook(projectDir: string, domain: string, maxChars: number): Promise<string> {
  const slug = slugify(domain);
  const primary = await boundedRead(join(projectDir, "lanes", "domains", `${slug}.md`), maxChars, "head");
  if (primary) return primary;
  return boundedRead(join(projectDir, "bees", "domains", `${slug}.md`), maxChars, "head");
}

export async function buildBrainMemoryBundle(options: BrainMemoryBundleOptions = {}): Promise<string> {
  const brainRootDir = getBrainRootDir(options.brainRootDir);
  if (!brainRootDir) return "";
  const sectionMaxChars = options.sectionMaxChars ?? DEFAULT_SECTION_MAX_CHARS;
  const bundleMaxChars = options.bundleMaxChars ?? DEFAULT_BUNDLE_MAX_CHARS;
  const canonicalProject = slugify(options.canonicalProject ?? "hive");
  const project = options.project?.trim();
  const normalizedProject = project ? slugify(project) : "";
  const sections: string[] = [];

  if (normalizedProject === canonicalProject) {
    const projectDir = hiveProjectBrainDir(brainRootDir);
    const bee = options.bee ? slugify(options.bee) : "";
    const domain = options.domain ? slugify(options.domain) : "";

    sections.push(section("Agent Brief", await boundedRead(join(projectDir, "agent-brief.md"), sectionMaxChars, "head")));
    sections.push(section("Known Issues", await boundedRead(join(projectDir, "known-issues.md"), sectionMaxChars, "head")));
    if (bee) {
      sections.push(
        section(`Lane Playbook (${laneSlugForCompatibilityId(bee)})`, await readLanePlaybook(projectDir, bee, sectionMaxChars))
      );
    }
    if (domain) {
      sections.push(
        section(
          `Domain Playbook (${domain})`,
          await readDomainPlaybook(projectDir, domain, sectionMaxChars)
        )
      );
    }
  }

  if (options.role) {
    sections.push(section(`Role Playbook (${options.role})`, await readLegacyRolePlaybook(options.role, brainRootDir, sectionMaxChars)));
  }
  if (project) {
    sections.push(section(`Project Playbook (${project})`, await readLegacyProjectPlaybook(project, brainRootDir, sectionMaxChars)));
    sections.push(section(`Project Access Ledger (${project})`, await readLegacyAccessLedger(project, brainRootDir, sectionMaxChars)));
  }

  // Directive reflections are written per-run in SQLite; no file-based recaps in HiveMatrix

  const presentSections = sections.filter(Boolean);
  if (presentSections.length === 0) return "";

  const bundle = `\n\n--- Brain Memory Bundle ---\nPrefer this over stale session memory when there is a conflict.\n\n--- Brain Doc Policy ---\n${brainDocPolicyText(brainRootDir)}\n\n${presentSections.join("\n\n")}`;
  return bundle.length > bundleMaxChars ? `${bundle.slice(0, bundleMaxChars)}\n...` : bundle;
}

async function listDirWithTimeout(
  path: string,
  opts: { dirsOnly?: boolean; timeoutMs?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? BRAIN_READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const read = fs.readdir(path, { withFileTypes: true })
    .then((ents) => ents
      .filter((e) => (opts.dirsOnly ? e.isDirectory() : e.isFile()))
      .map((e) => e.name)
      .filter((n) => !n.startsWith(".")))
    .catch(() => null);
  try {
    return (await Promise.race([read, timeout])) ?? [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A lightweight, always-on INDEX of the brain — the list of active projects and
 * their most-recent docs (filenames only, no content). Front-loaded into every
 * agent run so the model KNOWS the operator's projects/decisions exist and will
 * reach for `brain_search` to read them — instead of answering blind. This is
 * the cheap counterpart to `buildBrainMemoryBundle` (which loads full content
 * only for the canonical project). Bounded + time-limited (Drive-stall safe).
 */
export async function buildBrainIndexBlock(options: {
  brainRootDir?: string;
  maxProjects?: number;
  maxDocsPerProject?: number;
} = {}): Promise<string> {
  const brainRootDir = getBrainRootDir(options.brainRootDir);
  if (!brainRootDir) return "";
  const maxProjects = options.maxProjects ?? 12;
  const maxDocs = options.maxDocsPerProject ?? 6;
  const projectsRoot = join(brainRootDir, "projects");
  const projects = (await listDirWithTimeout(projectsRoot, { dirsOnly: true })).sort().slice(0, maxProjects);
  if (projects.length === 0) return "";

  const lines: string[] = [];
  for (const proj of projects) {
    // date-prefixed filenames sort newest-last; show the most recent N.
    const docs = (await listDirWithTimeout(join(projectsRoot, proj)))
      .filter((n) => n.endsWith(".md") || n.endsWith(".html"))
      .sort()
      .slice(-maxDocs)
      .reverse();
    if (docs.length === 0) continue;
    lines.push(`  ${proj}/: ${docs.join(", ")}`);
  }
  if (lines.length === 0) return "";

  return `\n\n--- Brain Index (durable memory — the operator's projects & decisions live here) ---\n`
    + `Active projects under ${shortenHome(projectsRoot)} and their recent docs:\n`
    + `${lines.join("\n")}\n`
    + `ALWAYS consult relevant brain docs (via brain_search / GET /brain/search?q=...) before answering `
    + `questions about projects, decisions, or prior work — do not answer from assumption when the brain may hold the answer.`;
}

function hiveBrainScaffold(brainRootDir?: string): Array<{ path: string; content: string }> {
  const root = scaffoldRootDisplay(brainRootDir);
  return [
    {
      path: "agent-brief.md",
      content: `# Hive Agent Brief

Hive is the control plane for capability lanes and focused workers.

## Operating rules

- Keep Hive responsible for routing, approvals, policy, capability health, artifacts, traces, progress visibility, and memory assembly.
- Keep workers narrow. A worker can own transport or capability execution, but it should not grow its own orchestration system.
- Treat Browser Lane as the single browser/web capability surface.
- Treat authentication and session state as an internal plane, not a public capability brand.
- Treat video/channel workflows as layers that consume shared Hive capabilities.
- Prefer durable updates to \`${root}\` over hidden session memory or repo-local notes when recording decisions.
- Treat the worker contract in \`src/lib/central\` as the first canonical capability-worker protocol.
`,
    },
    {
      path: "current-state.md",
      content: `# Hive Current State

- Step 1 worker contract lives in \`src/lib/central/contracts.ts\` and is adopted by the current central manager and worker routes.
- Legacy compiled playbooks still live under \`${root}/hive/playbooks\` and remain a compatibility source during migration.
- Mission recaps are written under \`${root}/sources/missions/recaps\` and can now be assembled into prompt memory bundles.
- Browser Lane is the active browser/web capability surface inside Hive, while auth is framed as an internal session/identity plane.
`,
    },
    {
      path: "decisions.md",
      content: `# Hive Decisions

- Canonical durable Hive memory belongs under \`${root}/projects/hive\`.
- Legacy role and project playbooks remain readable until their contents are migrated into the canonical structure.
- Manager Lane is the first lane that should consume the shared brain-memory bundle, because it coordinates strategy, planning, review, and task execution.
- Video workflows should consume shared browser, web, and brain capabilities instead of owning a separate runtime story.
- Terminal Lane is the terminal capability contract, owned end-to-end by HiveMatrix: persistent in-process shell sessions, no external provider.
`,
    },
    {
      path: "known-issues.md",
      content: `# Hive Known Issues

- Brain centralization is in transition: some prompt context still arrives through repo-local instructions or CLI-native memory surfaces.
- Most historical capability guidance still exists as specs in \`${root}/hive/*.md\`, not yet as compact lane playbooks under \`${root}/projects/hive/lanes/\`.
- Hive mission recap coverage for the \`hive\` project itself is still sparse, so early recap retrieval may return no excerpts.
`,
    },
    {
      path: "lanes/overview.md",
      content: `# Lanes Overview

Lanes are narrow capability surfaces around Hive's control plane. Start with the first worker set:

- Message Lane: message ingress and delivery semantics
- Mail Lane: email ingress, drafting, and trust-aware normalization
- Browser Lane: live read-only retrieval and authenticated/rendered browser workflows
- Manager Lane: planning, orchestration, and execution coordination within Hive
- Memory Lane: memory maintenance, recap distillation, and playbook hygiene
- Capability Design Lane: governed capability invention for new lanes, MCPs, skills, and shared contracts
`,
    },
    {
      path: "lanes/manager.md",
      content: `# Manager Lane

## Role

Manager Lane coordinates tasks that stay inside Hive's control plane: planning, routing, worker assignment, review, and follow-through.

## Boundaries

- Own orchestration decisions, not channel transport.
- Read the shared brain-memory bundle before planning or reviewing work.
- Prefer changing playbooks, checklists, and routing rules before proposing runtime mutations.
`,
    },
    {
      path: "lanes/browser.md",
      content: `# Browser Lane

- Operate as Hive's embedded browser and web lane.
- Use read/search mode for fresh public information with citations and evidence.
- Use workflow mode for authentication, rendered state, clicks, uploads, screenshots, and traces.
- Do not become mission orchestration.
`,
    },
    {
      path: "lanes/memory.md",
      content: `# Memory Lane

## What It Is For

Memory Lane is Hive's dedicated durable-memory worker. It curates the canonical brain root at \`${root}\`, keeps the Hive scaffold in place, and prepares bounded memory bundles for Hive and other lanes.

## What It Should Do

- Maintain the canonical durable memory structure under \`${root}\`.
- Compile retrospectives into stable playbooks, decisions, access ledgers, and lane notes.
- Detect stale, duplicated, or contradictory memory and surface cleanup targets.
- Prepare bounded retrieval bundles for Hive planning, review, and lane jobs.

## How To Use It

- Point Hive's Memory setting at the desired brain root. Memory Lane should follow that setting automatically.
- Use Memory Lane jobs for scaffold repair, memory-root inspection, and bundle previews.
- Treat Memory Lane as the curator of durable memory, not as a general-purpose executor or planner.
`,
    },
    {
      path: "lanes/capability-design.md",
      content: `# Capability Design Lane

- Detect repeated capability gaps and decide whether Hive needs a new skill, MCP, lane, or shared capability contract.
- Prefer governed proposals, scaffolds, tests, and evaluation seeds before proposing any live runtime mutation.
- Auto-apply only low-risk procedural additions; require review for auth, voice, browser, desktop, routing, or cross-repo runtime changes.
`,
    },
    {
      path: "lanes/scheduler.md",
      content: `# Scheduler Lane

- Own schedule management, recurring triggers, and watcher-style task factories.
- Create work through Hive's scheduler surfaces without owning execution outcomes.
- Keep trigger definitions explicit, reviewable, and mission-aware.
`,
    },
    {
      path: "lanes/desktop.md",
      content: `# Desktop Lane

- Own approval-heavy native desktop automation for macOS app flows, dialogs, installers, and settings work.
- Prefer Browser Lane or direct APIs when they are safer and more stable than desktop control.
- Keep app scope, approvals, screenshots, and traces explicit.
`,
    },
    {
      path: "lanes/terminal.md",
      content: `# Terminal Lane

- Define Hive's terminal, repo, and session contract.
- Own the capability surface end-to-end inside HiveMatrix: persistent in-process shell sessions, no external provider.
- Keep terminal execution distinct from browser, web, and voice layers while sharing the same mission and memory substrate.
`,
    },
    {
      path: "runbooks/README.md",
      content: `# Hive Runbooks

Use this directory for operational runbooks that should be durable and human-readable.
`,
    },
    {
      path: "evaluations/README.md",
      content: `# Hive Evaluations

Store evaluation summaries, scorecards, and regression notes here.
`,
    },
    {
      path: "retrospectives/README.md",
      content: `# Hive Retrospectives

Store durable retrospective summaries here when they should outlive mission-scoped recap files.
`,
    },
    {
      path: "references/README.md",
      content: `# Hive References

Store compact external or internal reference material here when it should participate in canonical memory retrieval.
`,
    },
  ];
}

export async function ensureHiveBrainScaffold(brainRootDir?: string): Promise<string[]> {
  const projectDir = hiveProjectBrainDir(brainRootDir);
  const created: string[] = [];

  for (const entry of hiveBrainScaffold(brainRootDir)) {
    const path = join(projectDir, entry.path);
    if (existsSync(path)) continue;
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, entry.content);
    created.push(path);
  }

  return created;
}
