#!/usr/bin/env node
// HiveMatrix scope-wall: greps src/ for forbidden patterns.
// Run via: node scripts/scope-wall.mjs
// Exits 1 if any violation found. CI must pass this gate.

import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

// Each rule: { pattern (grep -E regex), label, allowFiles (array of path substrings to skip) }
const RULES = [
  // ── Removed product surfaces ──────────────────────────────────
  // NOTE on '\\b' vs '\b' throughout this file: in a JS string literal (single- OR
  // double-quoted) '\b' is the BACKSPACE control character, not a literal
  // backslash-b — so an un-escaped '\b' regex silently never matches and the rule
  // is inert. Always write '\\b'. (Bug found 2026-07-10 on the AuthBee/Weaver rule,
  // fixed file-wide 2026-07-11.)
  {
    pattern: '\\bIdeation\\b',
    label: 'Ideation surface (removed from Hive 2)',
  },
  {
    // NOTE: the "Personal Goals surface" ban was LIFTED 2026-07-12 at explicit
    // operator request — the native goals layer (goals/goal_checkins tables, the
    // goals_* chat tools, and the 🎯 Goals panel) is now sanctioned. See
    // DECISIONS.md. Only the retired GoalsBee *brand* stays forbidden.
    pattern: '\\bGoalsBee\\b',
    label: 'GoalsBee brand (retired — the goals layer is now the sanctioned surface)',
  },
  {
    pattern: "PersonalDivider|'personal'.*divider|divider.*personal",
    label: 'Personal dashboard divider (removed from Hive 2)',
  },
  {
    // Video factory / HeyGen video pipeline removed 2026-07-05 (Kokoro-only voice,
    // no video). Narrow to video-factory symbols so Browser Lane's generic HeyGen
    // site recognition (a browsable site, not the factory) is still allowed.
    pattern: 'lib/video/|runVideoFactory|/video/make|/video/heygen-workflow|/video/portal-complete|/video/publish-draft|dispatchHeyGenVideoWorkflow|heygen-portal-video|content-video-script',
    label: 'Video factory / HeyGen video pipeline (removed 2026-07-05 — Kokoro-only, no video)',
  },
  // ── Retired Bee brands ────────────────────────────────────────
  // VoiceBee un-deferred 2026-06-16 (Q12) — now an active voice ingress/egress
  // lane; see DECISIONS.md Q12 + the voice/video persona plan in brain.
  {
    pattern: '\\bTubeBee\\b',
    label: 'TubeBee (deferred from HiveMatrix v1 — no code allowed)',
    // catalog.test.ts: a comment asserting TubeBee is REMOVED, not a reintroduction
    // (surfaced when the \b escaping fix made this rule actually run, 2026-07-11).
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md', 'lib/lanes/catalog.test.ts'],
  },
  {
    pattern: '\\bComputerBee\\b',
    label: 'ComputerBee (renamed to DesktopBee — use DesktopBee everywhere)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md'],
  },
  {
    // "Weaver" is narrowly re-sanctioned as the Weaver Audit's accountability-auditor
    // persona name (2026-07-10 Capability Ratchet + Weaver Audit spec; see DECISIONS.md
    // Q18) — distinct from the legacy AuthBee/session internal codename this rule still
    // bans everywhere else. Only the files implementing/wiring/testing that one named
    // feature may use the string (comments included) — not a general re-opening.
    pattern: '\\bWeaver\\b|\\bAuthBee\\b',
    label: 'AuthBee/Weaver as public brand (internal only outside the sanctioned Weaver Audit persona; use Session* names) — see DECISIONS.md Q18',
    allowFiles: [
      'COMPONENT-MAP.md', 'DECISIONS.md',
      // Fixing this rule's '\b' escaping bug (see the NOTE above) surfaced two
      // pre-existing, legitimate regression assertions that the AuthBee brand is
      // ABSENT — not a reintroduction of it — which the rule had never actually
      // been checking until now.
      'lib/lanes/catalog.test.ts', 'lib/brain/memory-bundle.test.ts',
      'lib/flash/weaver-audit.ts', 'lib/flash/weaver-audit.test.ts',
      'lib/flash/ratchet.ts', 'lib/flash/ratchet.test.ts',
      'lib/flash/heartbeat.ts', 'lib/flash/heartbeat.test.ts',
      'daemon/server.ts', 'daemon/server.test.ts',
      // The 0.1.171 release note names the sanctioned Weaver Audit feature.
      'lib/version/changelog.ts',
    ],
  },
  // ── Removed data model ────────────────────────────────────────
  {
    // Double-quoted strings have the same \b-is-backspace pitfall — escaped here too.
    pattern: "CREATE TABLE.*missions\\b|FROM missions\\b|INSERT INTO missions\\b",
    label: 'missions table (replaced by directives/runs — do not create or query)',
  },
  // ── Removed subsystem: Flights / Work Packages (2026-07-06) ────
  // Broad prompts self-plan via Superpowers (workflow:"work") — the
  // decomposition-and-DAG subsystem is gone and must not return. Targets the
  // code symbols (dir path, tables, store/orchestrate APIs, the old flash tool)
  // so removal-note prose ("… Work Packages removed") stays allowed.
  {
    pattern: "lib/work-packages/|work_packages\\b|work_package_items\\b|flight_loops\\b|flight_loop_passes\\b|WorkPackageItem|createWorkPackage|advanceWorkPackage|startWorkPackage|flight-loop-scheduler|flight-loop-store|autonomyAutoStartsFlights|escalate_to_work_package|classifyIntake|forceWorkPackage",
    label: 'Flights / Work Packages subsystem (removed 2026-07-06 — broad prompts self-plan via Superpowers, workflow:"work")',
  },
  {
    pattern: "missionId.*TEXT|missionPhase.*TEXT|goalAncestry.*TEXT|scheduledTaskId.*TEXT",
    label: 'Removed task columns (missionId, missionPhase, goalAncestry, scheduledTaskId)',
    allowFiles: ['db/index.ts'],  // allow in schema migration only if it's a DROP note
  },
  // ── Removed model providers ───────────────────────────────────
  {
    pattern: "gemini|google-generative|generativeai|'google'.*provider|provider.*'google'",
    label: 'Google model provider (removed; Nano Banana and mflux are allowed by role, not provider)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md', 'QWEN-LOCAL-PROFILE.md', 'models/catalog', 'models/task-model'],
  },
  // ── Import restriction: packs/ → daemon/ only ─────────────────
  {
    pattern: "from ['\"].*lib/packs|from ['\"]@/lib/packs",
    label: 'packs/ imported outside daemon/ — only src/daemon/ may import @/lib/packs',
    allowFiles: ['daemon/', 'lib/packs/'],
  },
  // ── Complexity budget: no new persistent store without a decision ─
  // Concept-creep is the top predictor of "things break as tweaks land"
  // (see brain/2026-07-06 pipeline review, Subtraction Pass). New data stores /
  // orchestration primitives must be a conscious choice, not a quiet addition.
  // Schema lives in exactly two sanctioned files (the app DB + the brain index);
  // a CREATE TABLE anywhere else is a new store that needs a DECISIONS.md entry.
  {
    pattern: 'CREATE TABLE',
    label: 'New persistent store outside the sanctioned schema files — add a DECISIONS.md entry (concept budget, 2026-07-06)',
    allowFiles: ['db/index.ts', 'brain/index-db.ts', '.test.'],
    warnOnly: true,
  },
  // ── Scope freeze: no new Bee brands ──────────────────────────
  {
    pattern: '\\b[A-Z][a-z]+Bee\\b',
    label: 'Possible new Bee brand — check COMPONENT-MAP.md to confirm it is listed there',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md'],
    // Known/retired brands are allowed by CONTENT, not path — the old allowFiles
    // entries like 'TermBee' were path substrings that never matched anything.
    // (AuthBee/TubeBee/ComputerBee appear here so their absence-assertions don't
    // double-report; their own dedicated rules above still enforce the ban.)
    allowContent: /\b(Term|Browser|Web|Desktop|Cron|Message|Mail|Voice|Trader|Manager|Brain|Inventor|Auth|Tube|Computer)Bee\b/,
    warnOnly: true,  // warning, not hard fail — false positives possible with this broad pattern
  },
]

let violations = 0
let warnings = 0

function grepSrc(pattern, allowFiles, allowContent) {
  try {
    const out = execFileSync('grep', [
      '-rEn',
      pattern,
      SRC,
      "--include=*.ts",
      "--include=*.tsx",
      "--include=*.mjs",
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!out) return []
    return out.split('\n').filter(line => {
      if (!line) return false
      const relPath = relative(ROOT, line.split(':')[0])
      if (allowFiles && allowFiles.some(allow => relPath.includes(allow))) return false
      // Content-level allowance (e.g. known Bee brands): skip a hit line whose
      // matched content is sanctioned even though its path isn't allowlisted.
      if (allowContent) {
        const content = line.split(':').slice(2).join(':')
        if (allowContent.test(content)) return false
      }
      return true
    })
  } catch {
    return []
  }
}

console.log('\n🔍 HiveMatrix scope-wall check\n')

for (const rule of RULES) {
  const hits = grepSrc(rule.pattern, rule.allowFiles, rule.allowContent)
  if (hits.length === 0) {
    console.log(`  ✓ ${rule.label}`)
    continue
  }
  if (rule.warnOnly) {
    console.log(`  ⚠  WARN: ${rule.label}`)
    hits.forEach(h => console.log(`     ${h}`))
    warnings++
  } else {
    console.log(`  ✗ FAIL: ${rule.label}`)
    hits.forEach(h => console.log(`     ${h}`))
    violations++
  }
}

console.log(`\nResult: ${violations} violation(s), ${warnings} warning(s)\n`)

if (violations > 0) {
  console.error('Scope-wall FAILED. Fix violations before merging.')
  process.exit(1)
}
