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
const DEFAULT_RECAP_MAX_CHARS = 1_500;
const DEFAULT_RECAP_LIMIT = 2;
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

export async function buildBrainMemoryBundle(options: BrainMemoryBundleOptions = {}): Promise<string> {
  const brainRootDir = getBrainRootDir(options.brainRootDir);
  if (!brainRootDir) return "";
  const sectionMaxChars = options.sectionMaxChars ?? DEFAULT_SECTION_MAX_CHARS;
  const recapMaxChars = options.recapMaxChars ?? DEFAULT_RECAP_MAX_CHARS;
  const recapLimit = options.recapLimit ?? DEFAULT_RECAP_LIMIT;
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
        section(`Bee Playbook (${bee})`, await boundedRead(join(projectDir, "bees", `${bee}.md`), sectionMaxChars, "head"))
      );
    }
    if (domain) {
      sections.push(
        section(
          `Domain Playbook (${domain})`,
          await boundedRead(join(projectDir, "bees", "domains", `${domain}.md`), sectionMaxChars, "head")
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

Hive is the control plane for Bee workers.

## Operating rules

- Keep Hive responsible for routing, approvals, policy, capability health, artifacts, traces, progress visibility, and memory assembly.
- Keep Bees narrow. A Bee can own transport or capability execution, but it should not grow its own orchestration system.
- Treat BrowserBee and WebBee as embedded Hive capability lanes, not sibling product stories.
- Treat AuthBee as an internal session plane, not a public Bee brand.
- Treat TubeBee as a workflow layer that consumes shared Hive capabilities.
- Prefer durable updates to \`${root}\` over hidden session memory or repo-local notes when recording decisions.
- Treat the worker contract in \`src/lib/central\` as the first canonical Bee protocol.
`,
    },
    {
      path: "current-state.md",
      content: `# Hive Current State

- Step 1 worker contract lives in \`src/lib/central/contracts.ts\` and is adopted by the current central manager and worker routes.
- Legacy compiled playbooks still live under \`${root}/hive/playbooks\` and remain a compatibility source during migration.
- Mission recaps are written under \`${root}/sources/missions/recaps\` and can now be assembled into prompt memory bundles.
- BrowserBee and WebBee remain active capability surfaces inside Hive, while AuthBee is now framed as an internal session/identity plane.
`,
    },
    {
      path: "decisions.md",
      content: `# Hive Decisions

- Canonical durable Hive memory belongs under \`${root}/projects/hive\`.
- Legacy role and project playbooks remain readable until their contents are migrated into the canonical structure.
- ManagerBee is the first Bee that should consume the shared brain-memory bundle, because it coordinates strategy, planning, review, and task execution.
- TubeBee should consume shared browser, web, and brain capabilities instead of owning a separate runtime story.
- TermBee is the terminal capability contract; Canopy is the current provider behind it.
`,
    },
    {
      path: "known-issues.md",
      content: `# Hive Known Issues

- Brain centralization is in transition: some prompt context still arrives through repo-local instructions or CLI-native memory surfaces.
- Most historical Bee guidance still exists as specs in \`${root}/hive/*.md\`, not yet as compact Bee playbooks under \`${root}/projects/hive/bees/\`.
- Hive mission recap coverage for the \`hive\` project itself is still sparse, so early recap retrieval may return no excerpts.
`,
    },
    {
      path: "bees/overview.md",
      content: `# Bees Overview

Bees are narrow workers around Hive's control plane. Start with the first worker set:

- MessageBee: message ingress and delivery semantics
- MailBee: email ingress, drafting, and trust-aware normalization
- WebBee: live read-only retrieval for fresh public information
- ManagerBee: planning, orchestration, and execution coordination within Hive
- BrainBee: memory maintenance, recap distillation, and playbook hygiene
- InventorBee: governed capability invention for new Bees, MCPs, skills, and shared contracts
`,
    },
    {
      path: "bees/managerbee.md",
      content: `# ManagerBee

## Role

ManagerBee coordinates tasks that stay inside Hive's control plane: planning, routing, worker assignment, review, and follow-through.

## Boundaries

- Own orchestration decisions, not channel transport.
- Read the shared brain-memory bundle before planning or reviewing work.
- Prefer changing playbooks, checklists, and routing rules before proposing runtime mutations.
`,
    },
    {
      path: "bees/webbee.md",
      content: `# WebBee

- Operate as Hive's embedded read-only web lane for fresh public information.
- Return citations, evidence, and normalized findings.
- Do not become browser automation or mission orchestration.
`,
    },
    {
      path: "bees/brainbee.md",
      content: `# BrainBee

## What It Is For

BrainBee is Hive's dedicated durable-memory worker. It curates the canonical brain root at \`${root}\`, keeps the Hive scaffold in place, and prepares bounded memory bundles for Hive and other Bees.

## What It Should Do

- Maintain the canonical durable memory structure under \`${root}\`.
- Compile retrospectives into stable playbooks, decisions, access ledgers, and Bee notes.
- Detect stale, duplicated, or contradictory memory and surface cleanup targets.
- Prepare bounded retrieval bundles for Hive planning, review, and Bee jobs.

## How To Use It

- Point Hive's Memory setting at the desired brain root. BrainBee should follow that setting automatically.
- Use BrainBee jobs for scaffold repair, memory-root inspection, and bundle previews.
- Treat BrainBee as the curator of durable memory, not as a general-purpose executor or planner.
`,
    },
    {
      path: "bees/inventorbee.md",
      content: `# InventorBee

- Detect repeated capability gaps and decide whether Hive needs a new skill, MCP, Bee, or shared capability contract.
- Prefer governed proposals, scaffolds, tests, and evaluation seeds before proposing any live runtime mutation.
- Auto-apply only low-risk procedural additions; require review for auth, voice, browser, desktop, routing, or cross-repo runtime changes.
`,
    },
    {
      path: "bees/browserbee.md",
      content: `# BrowserBee

- Operate as Hive's embedded browser lane when a site requires authentication, rendered state, or clicks.
- Prefer isolated browser execution by default and attach to the user's real browser only when necessary.
- Do not become the default path for public-web research that WebBee can answer more directly.
`,
    },
    {
      path: "bees/cronbee.md",
      content: `# CronBee

- Own schedule management, recurring triggers, and watcher-style task factories.
- Create work through Hive's scheduler surfaces without owning execution outcomes.
- Keep trigger definitions explicit, reviewable, and mission-aware.
`,
    },
    {
      path: "bees/computerbee.md",
      content: `# ComputerBee

- Own approval-heavy native desktop automation for macOS app flows, dialogs, installers, and settings work.
- Prefer BrowserBee or direct APIs when they are safer and more stable than desktop control.
- Keep app scope, approvals, screenshots, and traces explicit.
`,
    },
    {
      path: "bees/termbee.md",
      content: `# TermBee

- Define Hive's terminal, repo, and session contract.
- Treat Canopy as the current provider behind this capability surface.
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
