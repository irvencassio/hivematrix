#!/usr/bin/env node
/**
 * Wiring guard — find code that exists but is connected to nothing.
 *
 * Every defect this catches has the same shape: something was built, tested,
 * and never wired up. The unit tests all pass, because each piece is correct in
 * isolation; nothing asks "does anything call this?". Real examples found by
 * hand on 2026-07-21, each of which this guard would have caught:
 *
 *   - resolveWriterModel()  — Settings writes writerModel, writer-role.ts reads
 *                             it correctly, 6 tests pass, zero callers. The
 *                             whole Writer role was inert.
 *   - src/lib/bees/*        — a compatibility facade with no importers at all.
 *   - LEGACY_PREFIXES       — injected "/workflows:work", a skill that is not
 *                             installed, into every task's first turn.
 *
 * Two checks:
 *
 *   dead-export  an exported symbol referenced by nothing outside its own file
 *                (test files do not count as a consumer — a symbol whose only
 *                caller is its own test is the exact pattern above)
 *
 *   dead-module  a module with no production importer at all
 *
 * Findings are compared against wiring-guard-allowlist.json. The allowlist is a
 * ratchet, not an amnesty: entries are pre-existing debt with a reason, and the
 * guard fails on anything NEW. Deleting an allowlist entry after wiring or
 * removing the code is the intended direction of travel.
 *
 * Usage:  node scripts/wiring-guard.mjs [--json] [--update-allowlist]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname, basename } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const ALLOWLIST_PATH = join(ROOT, "scripts", "wiring-guard-allowlist.json");

/** Entry points: reachable by definition, nothing in-repo imports them. */
const ENTRY_POINTS = [
  /^src\/daemon\/index\.ts$/,
  /^src\/daemon\/server\.ts$/,
  /^src\/daemon\/console\.ts$/,
  /^src\/main\.tsx?$/,
  /^src\/index\.tsx?$/,
];

/** Types/interfaces are erased at runtime; a type-only export being unused is
 *  a lint concern, not a wiring defect. Value exports are what we care about. */
const TYPE_ONLY = /^\s*export\s+(?:type|interface)\s/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (rel) => /\.test\.[cm]?tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel);
const isEntry = (rel) => ENTRY_POINTS.some((re) => re.test(rel));

/** Exported value names declared in a source file. */
function exportedNames(src) {
  const names = new Set();
  const push = (n) => { if (n && n !== "default") names.add(n); };

  for (const line of src.split("\n")) {
    if (TYPE_ONLY.test(line)) continue;
    let m;
    if ((m = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line))) push(m[1]);
    else if ((m = /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line))) push(m[1]);
    else if ((m = /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/.exec(line))) push(m[1]);
    else if ((m = /^\s*export\s*\{([^}]*)\}/.exec(line))) {
      for (const part of m[1].split(",")) {
        const seg = part.trim();
        if (!seg || seg.startsWith("type ")) continue;
        push((seg.split(/\s+as\s+/).pop() || seg).trim());
      }
    }
  }
  return names;
}

const files = walk(SRC).map((f) => ({ abs: f, rel: relative(ROOT, f).replace(/\\/g, "/") }));
const sources = new Map(files.map((f) => [f.rel, readFileSync(f.abs, "utf-8")]));
const production = files.filter((f) => !isTest(f.rel));

// Reference index over production files only — a test is not a consumer.
const prodText = new Map();
for (const f of production) prodText.set(f.rel, sources.get(f.rel));

function referencedOutside(name, ownRel) {
  const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  for (const [rel, text] of prodText) {
    if (rel === ownRel) continue;
    if (word.test(text)) return true;
  }
  return false;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function importedByProduction(rel) {
  const stem = rel.replace(/^src\//, "").replace(/\.(tsx?|mts)$/, "");
  const base = basename(stem);
  // Must match BOTH static and dynamic forms. This codebase leans heavily on
  // `await import("@/lib/x")` inside route handlers to keep startup lazy — an
  // earlier version of this guard only looked for `from "..."` and reported 605
  // findings, nearly all of them modules that are dynamically imported. A guard
  // that cries wolf gets switched off, so specifier matching has to be complete.
  const specifier = `(?:@/${esc(stem)}|[^"']*/${esc(base)}|\\./${esc(base)})`;
  const re = new RegExp(`(?:from\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)["']${specifier}["']`);
  for (const [other, text] of prodText) {
    if (other === rel) continue;
    if (re.test(text)) return true;
  }
  return false;
}

const findings = [];

for (const f of production) {
  if (isEntry(f.rel)) continue;
  const src = sources.get(f.rel);

  if (!importedByProduction(f.rel)) {
    findings.push({ kind: "dead-module", file: f.rel, symbol: null });
    continue; // its exports are dead by construction; one finding is enough
  }

  for (const name of exportedNames(src)) {
    if (!referencedOutside(name, f.rel)) {
      findings.push({ kind: "dead-export", file: f.rel, symbol: name });
    }
  }
}

findings.sort((a, b) => (a.file + (a.symbol ?? "")).localeCompare(b.file + (b.symbol ?? "")));
const key = (f) => `${f.kind}:${f.file}${f.symbol ? `#${f.symbol}` : ""}`;

if (process.argv.includes("--update-allowlist")) {
  writeFileSync(
    ALLOWLIST_PATH,
    JSON.stringify(
      {
        _comment:
          "Pre-existing wiring debt. A ratchet, not an amnesty: the guard fails on anything NEW. " +
          "Remove an entry once the code is wired up or deleted — that is the intended direction. " +
          "Regenerate with: node scripts/wiring-guard.mjs --update-allowlist",
        allow: findings.map(key),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wiring-guard: allowlist written with ${findings.length} entr${findings.length === 1 ? "y" : "ies"}`);
  process.exit(0);
}

let allow = new Set();
try {
  allow = new Set(JSON.parse(readFileSync(ALLOWLIST_PATH, "utf-8")).allow ?? []);
} catch { /* no allowlist yet — every finding is new */ }

// Gate on dead-module by default; dead-export is a periodic sweep, not a gate.
// Calibration on this repo: 20 dead-modules (high signal — it independently
// found writer-role.ts, a whole role wired to nothing) vs 632 dead-exports
// (mostly exports kept for future use). A gate that fires 632 times gets
// disabled, and then it protects nothing. --strict opts into both.
const STRICT = process.argv.includes("--strict");
const gated = (f) => STRICT || f.kind === "dead-module";

const fresh = findings.filter((f) => gated(f) && !allow.has(key(f)));
const fixed = [...allow].filter((k) => !findings.some((f) => key(f) === k));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ findings, fresh, fixed }, null, 2));
} else {
  const mods = findings.filter((f) => f.kind === "dead-module").length;
  const exps = findings.length - mods;
  console.log(`wiring-guard: ${mods} dead-module, ${exps} dead-export${STRICT ? " (both gated)" : " (dead-export reported, not gated — use --strict)"}`);
  console.log(`              ${fresh.length} new, ${fixed.length} allowlisted-but-now-clean`);
  for (const f of fresh) {
    console.log(`  NEW  ${f.kind.padEnd(11)} ${f.file}${f.symbol ? ` :: ${f.symbol}` : ""}`);
  }
  if (fixed.length) {
    console.log(`\n  ${fixed.length} allowlist entr${fixed.length === 1 ? "y is" : "ies are"} stale (code wired or removed) — prune with --update-allowlist:`);
    for (const k of fixed.slice(0, 20)) console.log(`    ${k}`);
  }
}

process.exit(fresh.length ? 1 : 0);
