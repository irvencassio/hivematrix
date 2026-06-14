/**
 * Symbol lookup execution: one exact, word-boundary, fixed-string search
 * (ripgrep if present, else grep) over a project, then pure classification into
 * definitions vs references. Bounded + timed; never throws. Offline by nature.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { relative } from "path";
import {
  escapeRegex, isValidSymbol, parseMatchLine, classifyMatches,
  type CodeMatch, type SymbolGraph,
} from "./contracts";

const execAsync = promisify(exec);

async function hasRipgrep(): Promise<boolean> {
  try { await execAsync("command -v rg", { timeout: 3_000 }); return true; }
  catch { return false; }
}

export interface FindSymbolOptions {
  maxMatches?: number;
  timeoutMs?: number;
  /** Inject the search runner for tests (returns raw `file:line:text` lines). */
  runner?: (symbol: string, root: string, max: number) => Promise<string>;
}

async function defaultRunner(symbol: string, root: string, max: number, timeoutMs: number): Promise<string> {
  // -w word boundary, -F fixed string (symbol is validated to identifier chars,
  // so no shell metacharacters and no regex injection). Pipe to head to bound.
  const useRg = await hasRipgrep();
  const tool = useRg
    ? `rg -n --no-heading -w -F ${JSON.stringify(symbol)} ${JSON.stringify(root)}`
    : `grep -rn -w -F -e ${JSON.stringify(symbol)} ${JSON.stringify(root)}`;
  const cmd = `${tool} 2>/dev/null | head -n ${max + 1}`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 });
    return stdout;
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? "";
  }
}

export async function findSymbol(symbol: string, root: string, opts: FindSymbolOptions = {}): Promise<SymbolGraph> {
  const sym = symbol.trim();
  if (!isValidSymbol(sym)) {
    return { symbol: sym, definitions: [], references: [], scanned: 0, truncated: false };
  }
  // touch escapeRegex so the validated symbol is regex-safe for the pure classifier
  void escapeRegex(sym);
  const max = opts.maxMatches ?? 300;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const raw = opts.runner ? await opts.runner(sym, root, max) : await defaultRunner(sym, root, max, timeoutMs);

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const truncated = lines.length > max;
  const matches: CodeMatch[] = lines.slice(0, max)
    .map(parseMatchLine)
    .filter((m): m is CodeMatch => m !== null)
    .map((m) => ({ ...m, file: relative(root, m.file) || m.file }));

  return classifyMatches(sym, matches, truncated);
}
