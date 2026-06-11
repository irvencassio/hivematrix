import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export const ARTIFACTS_ROOT = join(homedir(), ".hivematrix", "artifacts");

export function ensureDirs(): void {
  mkdirSync(join(ARTIFACTS_ROOT, "tasks"), { recursive: true });
  mkdirSync(join(ARTIFACTS_ROOT, "missions"), { recursive: true });
  mkdirSync(join(ARTIFACTS_ROOT, "shared"), { recursive: true });
}

export function ensureScopeDir(scope: "task" | "mission" | "shared", scopeId: string | null): string {
  if (scope === "shared") {
    const d = join(ARTIFACTS_ROOT, "shared");
    mkdirSync(d, { recursive: true });
    return d;
  }
  const sub = scope === "task" ? "tasks" : "missions";
  const d = join(ARTIFACTS_ROOT, sub, scopeId ?? "");
  mkdirSync(d, { recursive: true });
  return d;
}

export function eventsPath(scope: "task" | "mission" | "shared", scopeId: string | null): string {
  if (scope === "shared") return join(ARTIFACTS_ROOT, "shared", "events.jsonl");
  const sub = scope === "task" ? "tasks" : "missions";
  return join(ARTIFACTS_ROOT, sub, scopeId ?? "", "events.jsonl");
}

/** Parse abs path → {scope, scopeId, filename} or null if outside ARTIFACTS_ROOT. */
export function parseArtifactPath(abs: string): { scope: "task" | "mission" | "shared"; scopeId: string | null; filename: string } | null {
  if (!abs.startsWith(ARTIFACTS_ROOT)) return null;
  const rel = abs.slice(ARTIFACTS_ROOT.length + 1);
  const parts = rel.split("/");
  if (parts[0] === "shared" && parts.length === 2) {
    return { scope: "shared", scopeId: null, filename: parts[1] };
  }
  if (parts[0] === "tasks" && parts.length === 3) {
    return { scope: "task", scopeId: parts[1], filename: parts[2] };
  }
  if (parts[0] === "missions" && parts.length === 3) {
    return { scope: "mission", scopeId: parts[1], filename: parts[2] };
  }
  return null;
}

/** Parse "NNN-stem.ext" → { version, stem, ext }. Falls back if no numeric prefix. */
export function parseFilename(filename: string): { version: number | null; stem: string; ext: string } {
  const m = filename.match(/^(\d{1,4})-(.+)\.([^.]+)$/);
  if (m) return { version: parseInt(m[1], 10), stem: m[2], ext: m[3].toLowerCase() };
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  return { version: null, stem, ext };
}

/** Hidden / sidecar files that should never be indexed as artifacts. */
export function isArtifactFile(filename: string): boolean {
  if (filename.startsWith(".")) return false;
  if (filename === "meta.json") return false;
  if (filename === "events.jsonl") return false;
  return true;
}
