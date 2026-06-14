/**
 * Deterministic code-intelligence — the layer that complements embeddings. The
 * strategy: one exact-symbol search (ripgrep), then PURE classification of each
 * hit as a definition vs a reference. Exact, fresh, offline, language-agnostic —
 * and it answers "where is X defined AND every place it's used," which closes the
 * "invisible 20%" that semantic similarity misses and powers the done-check
 * ("search for any other usage of the symbols you touched").
 */

export interface CodeMatch {
  file: string;
  line: number;
  text: string;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A symbol name is valid for lookup if it's an identifier (avoids regex abuse). */
export function isValidSymbol(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$.]{0,127}$/.test(s.trim());
}

/** Parse one `file:line:text` match line (rg -n / grep -rn format). */
export function parseMatchLine(line: string): CodeMatch | null {
  const m = line.match(/^(.+?):(\d+):(.*)$/);
  if (!m) return null;
  const ln = parseInt(m[2], 10);
  if (!Number.isFinite(ln)) return null;
  return { file: m[1], line: ln, text: m[3] };
}

/**
 * Pure heuristic: does this line DEFINE `symbol` (vs merely reference it)?
 * Conservative, language-agnostic keyword + assignment + signature patterns.
 */
export function isDefinitionLine(symbol: string, text: string): boolean {
  const e = escapeRegex(symbol);
  const patterns = [
    // keyword-led declarations: function/class/interface/type/enum/struct/trait/func/fn/def/module/namespace X
    new RegExp(`\\b(function|class|interface|type|enum|struct|trait|func|fn|def|module|namespace|impl)\\s+${e}\\b`),
    // binding declarations: const/let/var/val/static X
    new RegExp(`\\b(const|let|var|val|static)\\s+${e}\\b`),
    // assignment to a callable/value: X = function|async|( ... ) =>  | X := ...
    new RegExp(`\\b${e}\\s*:?=\\s*(function|async|\\(|class)`),
    // method/function signature: X(...) {  or X(...):
    new RegExp(`\\b${e}\\s*\\([^)]*\\)\\s*[:{=]`),
  ];
  return patterns.some((p) => p.test(text));
}

export interface SymbolGraph {
  symbol: string;
  definitions: CodeMatch[];
  references: CodeMatch[];
  scanned: number;
  truncated: boolean;
}

/** Classify a flat list of matches into a SymbolGraph. Pure. */
export function classifyMatches(symbol: string, matches: CodeMatch[], truncated: boolean): SymbolGraph {
  const definitions: CodeMatch[] = [];
  const references: CodeMatch[] = [];
  for (const m of matches) {
    if (isDefinitionLine(symbol, m.text)) definitions.push(m);
    else references.push(m);
  }
  return { symbol, definitions, references, scanned: matches.length, truncated };
}

/** Render a SymbolGraph as the string a tool returns. */
export function formatSymbolGraph(g: SymbolGraph): string {
  if (g.definitions.length === 0 && g.references.length === 0) {
    return `No occurrences of "${g.symbol}" found.`;
  }
  const fmt = (m: CodeMatch) => `  ${m.file}:${m.line}  ${m.text.trim().slice(0, 160)}`;
  const lines: string[] = [];
  lines.push(`Symbol "${g.symbol}" — ${g.definitions.length} definition(s), ${g.references.length} reference(s)${g.truncated ? " (truncated)" : ""}:`);
  if (g.definitions.length) lines.push("Definitions:", ...g.definitions.slice(0, 20).map(fmt));
  if (g.references.length) lines.push("References:", ...g.references.slice(0, 40).map(fmt));
  return lines.join("\n");
}
