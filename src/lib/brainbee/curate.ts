/**
 * BrainBee — playbook hygiene.
 *
 * Directive retrospectives append rule deltas to playbook files
 * (hive/playbooks/{roles,projects}/*.md). Over many runs the same rule is
 * appended again and again across dated sections. BrainBee curates: it keeps
 * the first occurrence of each rule and drops later exact duplicates, then
 * prunes dated section headers left empty. Pure over file content so it is
 * trivially testable; the poller wraps it on a schedule.
 */

import { promises as fs } from "fs";
import { existsSync } from "fs";
import { join, resolve } from "path";

export interface PlaybookCurationResult {
  content: string;
  removed: number;
}

type Token =
  | { kind: "line"; text: string }
  | { kind: "entry"; lines: string[]; key: string };

/** Normalize a rule bullet to a dedup key: drop the marker, confidence suffix, case. */
function ruleKey(bulletLine: string): string {
  return bulletLine
    .replace(/^- /, "")
    .replace(/\*\(confidence:[^)]*\)\*/i, "")
    .trim()
    .toLowerCase();
}

export function curatePlaybookBody(text: string): PlaybookCurationResult {
  const lines = text.split("\n");

  // Tokenize: a top-level `- ` bullet plus its indented continuation lines is
  // one entry; everything else passes through as a plain line.
  const tokens: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^- /.test(line)) {
      const entryLines = [line];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^- /.test(lines[i])) {
        entryLines.push(lines[i]);
        i++;
      }
      tokens.push({ kind: "entry", lines: entryLines, key: ruleKey(line) });
    } else {
      tokens.push({ kind: "line", text: line });
      i++;
    }
  }

  // Drop duplicate entries (keep first occurrence).
  const seen = new Set<string>();
  let removed = 0;
  const kept: Token[] = [];
  for (const t of tokens) {
    if (t.kind === "entry" && t.key) {
      if (seen.has(t.key)) {
        removed += 1;
        continue;
      }
      seen.add(t.key);
    }
    kept.push(t);
  }

  // Prune dated section headers (## …) with no entries left beneath them.
  const pruned: Token[] = [];
  for (let j = 0; j < kept.length; j++) {
    const t = kept[j];
    if (t.kind === "line" && /^## /.test(t.text)) {
      let hasEntry = false;
      for (let k = j + 1; k < kept.length; k++) {
        const nx = kept[k];
        if (nx.kind === "line" && /^#{1,2} /.test(nx.text)) break;
        if (nx.kind === "entry") {
          hasEntry = true;
          break;
        }
      }
      if (!hasEntry) {
        let k = j + 1;
        while (k < kept.length && kept[k].kind === "line" && (kept[k] as { text: string }).text.trim() === "") k++;
        j = k - 1;
        continue;
      }
    }
    pruned.push(t);
  }

  const out: string[] = [];
  for (const t of pruned) {
    if (t.kind === "entry") out.push(...t.lines);
    else out.push(t.text);
  }
  // Collapse runs of 3+ blank lines left by pruning down to a single gap.
  const content = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { content, removed };
}

export interface PlaybookCurationSummary {
  ranAt: string;
  scanned: number;
  files: Array<{ path: string; removed: number }>;
  totalRemoved: number;
}

/** Curate every playbook under <brainRoot>/hive/playbooks; rewrite only changed files. */
export async function curatePlaybooksUnder(
  brainRootDir: string,
  nowIso: string = new Date().toISOString(),
): Promise<PlaybookCurationSummary> {
  const playbooksDir = join(resolve(brainRootDir), "hive", "playbooks");
  const files: Array<{ path: string; removed: number }> = [];
  let scanned = 0;

  for (const sub of ["roles", "projects"]) {
    const dir = join(playbooksDir, sub);
    if (!existsSync(dir)) continue;
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      scanned += 1;
      const original = await fs.readFile(path, "utf-8");
      const { content, removed } = curatePlaybookBody(original);
      if (removed > 0 && content !== original) {
        await fs.writeFile(path, content);
        files.push({ path, removed });
      }
    }
  }

  return {
    ranAt: nowIso,
    scanned,
    files,
    totalRemoved: files.reduce((sum, f) => sum + f.removed, 0),
  };
}
