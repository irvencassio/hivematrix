#!/usr/bin/env node
// HiveMatrix scope-wall: greps src/ for forbidden patterns.
// Run via: node scripts/scope-wall.mjs
// Exits 1 if any violation found. CI must pass this gate.

import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

// Each rule: { pattern (grep -E regex), label, allowFiles (array of path substrings to skip) }
const RULES = [
  // ── Removed product surfaces ──────────────────────────────────
  {
    pattern: '\bIdeation\b',
    label: 'Ideation surface (removed from Hive 2)',
  },
  {
    pattern: '\bGoalsBee\b|personal.*Goals|Goals.*personal|isPersonal.*goal|goal.*surface',
    label: 'Personal Goals surface (removed from Hive 2)',
  },
  {
    pattern: "PersonalDivider|'personal'.*divider|divider.*personal",
    label: 'Personal dashboard divider (removed from Hive 2)',
  },
  // ── Retired Bee brands ────────────────────────────────────────
  // VoiceBee un-deferred 2026-06-16 (Q12) — now an active voice ingress/egress
  // lane; see DECISIONS.md Q12 + the voice/video persona plan in brain.
  {
    pattern: '\bTubeBee\b',
    label: 'TubeBee (deferred from HiveMatrix v1 — no code allowed)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md'],
  },
  {
    pattern: '\bComputerBee\b',
    label: 'ComputerBee (renamed to DesktopBee — use DesktopBee everywhere)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md'],
  },
  {
    pattern: '\bWeaver\b|\bAuthBee\b',
    label: 'AuthBee/Weaver as public brand (internal only; use Session* names)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md'],
  },
  // ── Removed data model ────────────────────────────────────────
  {
    pattern: "CREATE TABLE.*missions\b|FROM missions\b|INSERT INTO missions\b",
    label: 'missions table (replaced by directives/runs — do not create or query)',
  },
  {
    pattern: "missionId.*TEXT|missionPhase.*TEXT|goalAncestry.*TEXT|scheduledTaskId.*TEXT",
    label: 'Removed task columns (missionId, missionPhase, goalAncestry, scheduledTaskId)',
    allowFiles: ['db/index.ts'],  // allow in schema migration only if it's a DROP note
  },
  // ── Removed model providers ───────────────────────────────────
  {
    pattern: "gemini|google-generative|generativeai|\'google\'.*provider|provider.*\'google\'",
    label: 'Google model provider (removed; Nano Banana and mflux are allowed by role, not provider)',
    allowFiles: ['COMPONENT-MAP.md', 'DECISIONS.md', 'QWEN-LOCAL-PROFILE.md', 'models/catalog', 'models/task-model'],
  },
  // ── Scope freeze: no new Bee brands ──────────────────────────
  {
    pattern: '\b[A-Z][a-z]+Bee\b',
    label: 'Possible new Bee brand — check COMPONENT-MAP.md to confirm it is listed there',
    allowFiles: [
      'TermBee', 'BrowserBee', 'WebBee', 'DesktopBee', 'CronBee', 'MessageBee',
      'messagebee', 'MailBee', 'mailbee', 'VoiceBee', 'voicebee', 'TraderBee', 'traderbee',
      'COMPONENT-MAP.md', 'DECISIONS.md',
    ],
    warnOnly: true,  // warning, not hard fail — false positives possible with this broad pattern
  },
]

let violations = 0
let warnings = 0

function grepSrc(pattern, allowFiles) {
  try {
    const cmd = `grep -rEn '${pattern}' '${SRC}' --include='*.ts' --include='*.tsx' --include='*.mjs' 2>/dev/null`
    const out = execSync(cmd, { encoding: 'utf8' }).trim()
    if (!out) return []
    return out.split('\n').filter(line => {
      if (!line) return false
      const relPath = relative(ROOT, line.split(':')[0])
      return !allowFiles || !allowFiles.some(allow => relPath.includes(allow))
    })
  } catch {
    return []
  }
}

console.log('\n🔍 HiveMatrix scope-wall check\n')

for (const rule of RULES) {
  const hits = grepSrc(rule.pattern, rule.allowFiles)
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
