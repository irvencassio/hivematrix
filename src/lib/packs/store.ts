import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { homedir } from "os";
import { parseHmpack } from "./parser";
import type { PackDashboardCard, PackManifestPayload, ParsedPack } from "./types";
import { createDirective, deleteDirective, type DirectiveRow } from "@/lib/orchestrator/directive-store";
import { deleteSkill, skillSlug, upsertSkill } from "@/lib/skills/store";
import { scanSkillContent } from "@/lib/skills/scan";
import { readHiveConfig } from "@/lib/brain/settings";

export interface InstalledPack {
  name: string;
  version: string;
  description: string;
  tier: string;
  installedAt: string;
  manifest: PackManifestPayload;
  skillNames: string[];
  directiveIds: string[];
  dashboardCard: PackDashboardCard;
}

export interface PackInstallResult {
  pack: InstalledPack;
  replaced: boolean;
}

export interface PackInstallFailure {
  ok: false;
  error: string;
}

interface PackState {
  packs: InstalledPack[];
}

export type PackInstallInput =
  | { buffer: Buffer; publicKeyPem?: string | null; now?: string }
  | { path: string; publicKeyPem?: string | null; now?: string };

function packsRoot(): string {
  return join(homedir(), ".hivematrix", "packs");
}

function statePath(): string {
  return join(packsRoot(), "installed.json");
}

function installedPackDir(name: string): string {
  return join(packsRoot(), "installed", skillSlug(name));
}

function readState(): PackState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as PackState).packs)) {
      return parsed as PackState;
    }
  } catch (e) {
    // Absent file = no installed packs yet. Anything else (corrupt JSON,
    // permissions, I/O) must leave a trail — a silent [] here reads as "no
    // packs" in the console and invites duplicate re-installs.
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[packs] could not read installed.json (treating as no packs): ${e instanceof Error ? e.message : e}`);
    }
  }
  return { packs: [] };
}

function writeState(state: PackState): void {
  mkdirSync(packsRoot(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ packs: state.packs }, null, 2));
}

function configuredPackPublicKey(): string | null {
  const cfg = readHiveConfig();
  const rawPacks = cfg.packs && typeof cfg.packs === "object" ? cfg.packs as Record<string, unknown> : {};
  const pem = typeof rawPacks.publicKeyPem === "string" ? rawPacks.publicKeyPem.trim() : "";
  if (pem) return pem;
  const path = typeof rawPacks.publicKeyPath === "string" ? rawPacks.publicKeyPath.trim() : "";
  if (!path) return null;
  try {
    return readFileSync(path.replace(/^~\//, `${homedir()}/`), "utf8");
  } catch {
    return null;
  }
}

export function configuredPackPrivateKey(): string | null {
  const cfg = readHiveConfig();
  const rawPacks = cfg.packs && typeof cfg.packs === "object" ? cfg.packs as Record<string, unknown> : {};
  const pem = typeof rawPacks.privateKeyPem === "string" ? rawPacks.privateKeyPem.trim() : "";
  if (pem) return pem;
  const path = typeof rawPacks.privateKeyPath === "string" ? rawPacks.privateKeyPath.trim() : "";
  if (!path) return null;
  try {
    return readFileSync(path.replace(/^~\//, `${homedir()}/`), "utf8");
  } catch {
    return null;
  }
}

function parseDirectiveTemplate(template: unknown, pack: ParsedPack): Parameters<typeof createDirective>[0] {
  const t = template && typeof template === "object" ? template as Record<string, unknown> : {};
  const goal = typeof t.goal === "string" && t.goal.trim()
    ? t.goal.trim()
    : typeof t.name === "string" && t.name.trim()
      ? `${pack.manifest.name}: ${t.name.trim()}`
      : `${pack.manifest.name}: ${pack.manifest.description}`;
  return {
    goal: `[pack:${pack.manifest.name}] ${goal}`,
    profile: typeof t.profile === "string" && t.profile.trim() ? t.profile.trim() : "default",
    project: typeof t.project === "string" && t.project.trim() ? t.project.trim() : "hivematrix",
    projectPath: typeof t.projectPath === "string" && t.projectPath.trim() ? t.projectPath.trim() : homedir(),
    triggerPolicy: t.triggerPolicy && typeof t.triggerPolicy === "object" ? t.triggerPolicy as Record<string, unknown> : { type: "manual" },
    budgetPolicy: t.budgetPolicy && typeof t.budgetPolicy === "object" ? t.budgetPolicy as Record<string, unknown> : {},
    approvalPolicy: t.approvalPolicy && typeof t.approvalPolicy === "object" ? t.approvalPolicy as Record<string, unknown> : {},
    brainSelection: t.brainSelection ?? [],
    status: t.status === "sleeping" ? "sleeping" : "active",
    nextRunAt: typeof t.nextRunAt === "string" ? t.nextRunAt : null,
  };
}

function skillNameForPath(packName: string, path: string): string {
  const base = basename(path).replace(/\.md$/i, "").trim() || "skill";
  return `${packName}:${base}`;
}

function writePackFiles(pack: ParsedPack): void {
  const dir = installedPackDir(pack.manifest.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(pack.manifest, null, 2));
  for (const [path, body] of Object.entries(pack.skills)) {
    const safe = path.replace(/[^a-zA-Z0-9._/-]+/g, "_").replace(/\.\./g, "_");
    const out = join(dir, safe);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
  }
  for (const [path, body] of Object.entries(pack.directives)) {
    const safe = path.replace(/[^a-zA-Z0-9._/-]+/g, "_").replace(/\.\./g, "_");
    const out = join(dir, safe);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(body, null, 2));
  }
  if (pack.personaAdditions) writeFileSync(join(dir, "HEARTBEAT.md"), pack.personaAdditions);
}

export function listInstalledPacks(): InstalledPack[] {
  return readState().packs;
}

export function getPackDashboardCards(): Array<PackDashboardCard & { packName: string; packVersion: string }> {
  return listInstalledPacks().map((pack) => ({
    ...pack.dashboardCard,
    packName: pack.name,
    packVersion: pack.version,
  }));
}

export async function uninstallPack(name: string): Promise<boolean> {
  const state = readState();
  const pack = state.packs.find((p) => p.name === name);
  if (!pack) return false;

  if (pack.manifest.uninstall.removeDirectives) {
    for (const id of pack.directiveIds) deleteDirective(id);
  }
  if (pack.manifest.uninstall.removeSkills) {
    for (const skillName of pack.skillNames) await deleteSkill(skillName);
  }
  rmSync(installedPackDir(pack.name), { recursive: true, force: true });
  writeState({ packs: state.packs.filter((p) => p.name !== name) });
  return true;
}

export async function installPack(input: PackInstallInput): Promise<PackInstallResult | PackInstallFailure> {
  const buffer = "buffer" in input ? input.buffer : readFileSync(input.path);
  const key = input.publicKeyPem !== undefined ? input.publicKeyPem : configuredPackPublicKey();
  const parsed = parseHmpack(buffer, key ?? null);
  if (!parsed.ok) return parsed;

  const blockedSkill = Object.entries(parsed.pack.skills)
    .map(([path, body]) => ({ path, scan: scanSkillContent(body, "instruction") }))
    .find(({ scan }) => scan.verdict === "block");
  if (blockedSkill) {
    const rules = blockedSkill.scan.findings.map((finding) => finding.rule).join(", ");
    return { ok: false, error: `skill scan blocked ${blockedSkill.path}: ${rules}` };
  }

  const existing = readState().packs.some((p) => p.name === parsed.pack.manifest.name);
  if (existing) await uninstallPack(parsed.pack.manifest.name);

  const skillNames: string[] = [];
  for (const [path, body] of Object.entries(parsed.pack.skills)) {
    const name = skillNameForPath(parsed.pack.manifest.name, path);
    await upsertSkill({
      name,
      description: `${parsed.pack.manifest.description} (${path})`,
      tags: ["pack", parsed.pack.manifest.name],
      body,
      source: `pack:${parsed.pack.manifest.name}`,
      trusted: true,
      compat: ["all"],
      kind: "instruction",
      interpreter: "bash",
      now: input.now,
    });
    skillNames.push(name);
  }

  const directives: DirectiveRow[] = [];
  for (const directive of Object.values(parsed.pack.directives)) {
    directives.push(createDirective(parseDirectiveTemplate(directive, parsed.pack)));
  }

  writePackFiles(parsed.pack);
  const installed: InstalledPack = {
    name: parsed.pack.manifest.name,
    version: parsed.pack.manifest.version,
    description: parsed.pack.manifest.description,
    tier: parsed.pack.manifest.tier,
    installedAt: input.now ?? new Date().toISOString(),
    manifest: parsed.pack.manifest,
    skillNames,
    directiveIds: directives.map((d) => d._id),
    dashboardCard: parsed.pack.manifest.dashboardCard,
  };
  const state = readState();
  writeState({ packs: [...state.packs.filter((p) => p.name !== installed.name), installed] });
  return { pack: installed, replaced: existing };
}
