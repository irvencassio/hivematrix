/**
 * Command options model + parsers — turn a command's flags into a structured,
 * pickable spec for the console's new-task box.
 *
 * Two sources (design: docs/superpowers/specs/2026-07-05-command-options-picker-design.md):
 *   - Tier 1: parse the conventional `argument-hint` string (zero re-authoring).
 *   - Tier 2: an explicit `options:` frontmatter DSL (one option per line, with
 *     descriptions/groups/choices) — richer, wins when present.
 * Both normalize to a `CommandOptionsSpec` (≈ Fig/Discord option objects). Pure;
 * never throws (unparseable input degrades to fewer/no options + the raw box).
 */

export type CommandOptionKind = "flag" | "value" | "choice" | "positional";

export interface CommandOption {
  /** "--release" | "--marketing-version" | positional "pr-number". */
  name: string;
  kind: CommandOptionKind;
  required: boolean;
  /** Tier 2 only — human description shown as a tooltip/subtext. */
  description?: string;
  /** kind=value — placeholder for the value input, e.g. "X.Y.Z". */
  valuePlaceholder?: string;
  /** kind=choice — enumerated values for a dropdown. */
  choices?: string[];
  /** Exclusivity group id (flags only) → rendered as pick-one. */
  group?: string;
}

export interface CommandOptionsSpec {
  options: CommandOption[];
  positionals: CommandOption[];
  source: "frontmatter" | "argument-hint" | "none";
}

const EMPTY: CommandOptionsSpec = { options: [], positionals: [], source: "none" };

function stripBrackets(t: string): string {
  return t.replace(/^[<[]+|[>\]]+$/g, "").trim();
}

function isFlagToken(t: string): boolean {
  return t.startsWith("-") && t.length > 1 && !/^-?\d/.test(t.slice(1));
}

/** A next-token looks like a flag's value (placeholder-ish) rather than a separate positional. */
function isValueish(t: string): boolean {
  if (/^<.+>$/.test(t)) return true; // <pattern>
  if (t.includes("|")) return true; // a|b|c
  const s = stripBrackets(t);
  return /[A-Z]/.test(s) && /^[A-Za-z0-9.\-_]+$/.test(s) && s === s.toUpperCase() ? true : s.includes(".");
}

interface Seg { tok: string; optional: boolean }

/** Split a hint into tokens, capturing [ … ] groups (optional) and <name> (required positional). */
function segment(hint: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const s = hint;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "[") {
      let depth = 1, j = i + 1;
      while (j < s.length && depth > 0) { if (s[j] === "[") depth++; else if (s[j] === "]") depth--; j++; }
      for (const sub of segment(s.slice(i + 1, j - 1))) segs.push({ tok: sub.tok, optional: true });
      i = j;
      continue;
    }
    if (ch === "<") {
      let j = i + 1;
      while (j < s.length && s[j] !== ">") j++;
      segs.push({ tok: "<" + s.slice(i + 1, j) + ">", optional: false });
      i = j + 1;
      continue;
    }
    if (ch === "|") { segs.push({ tok: "|", optional: false }); i++; continue; }
    let j = i;
    while (j < s.length && !/[\s[<\]>]/.test(s[j]) && s[j] !== "|") j++;
    // keep a|b|c together: only stop at a bare `|` when it is NOT flanked by word chars
    while (j < s.length && s[j] === "|" && j + 1 < s.length && !/[\s[<\]>]/.test(s[j + 1])) {
      j++;
      while (j < s.length && !/[\s[<\]>|]/.test(s[j])) j++;
    }
    segs.push({ tok: s.slice(i, j), optional: false });
    i = j;
  }
  return segs;
}

/** Tier 1 — parse a conventional `argument-hint` string. */
export function parseArgumentHint(hint: string): CommandOptionsSpec {
  if (!hint || !hint.trim()) return { ...EMPTY };
  const segs = segment(hint.trim());
  const options: CommandOption[] = [];
  const positionals: CommandOption[] = [];
  let groupN = 0;
  let pendingGroup: string | null = null;
  let lastFlag: CommandOption | null = null;

  for (let k = 0; k < segs.length; k++) {
    const { tok, optional } = segs[k];
    if (tok === "|") {
      if (lastFlag) {
        if (!lastFlag.group) lastFlag.group = `g${++groupN}`;
        pendingGroup = lastFlag.group;
      } else {
        pendingGroup = `g${++groupN}`;
      }
      continue;
    }
    if (isFlagToken(tok)) {
      let name = tok;
      let kind: CommandOptionKind = "flag";
      let valuePlaceholder: string | undefined;
      let choices: string[] | undefined;
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        name = tok.slice(0, eq);
        const val = tok.slice(eq + 1);
        if (val.includes("|")) { kind = "choice"; choices = val.split("|").filter(Boolean); }
        else { kind = "value"; valuePlaceholder = stripBrackets(val); }
      } else {
        const next = segs[k + 1];
        if (next && next.tok !== "|" && !isFlagToken(next.tok) && isValueish(next.tok)) {
          if (next.tok.includes("|") && !next.tok.startsWith("<")) {
            kind = "choice"; choices = next.tok.split("|").filter(Boolean);
          } else {
            kind = "value"; valuePlaceholder = stripBrackets(next.tok);
          }
          k++;
        }
      }
      const opt: CommandOption = { name, kind, required: false };
      if (valuePlaceholder) opt.valuePlaceholder = valuePlaceholder;
      if (choices) opt.choices = choices;
      if (pendingGroup) opt.group = pendingGroup;
      options.push(opt);
      lastFlag = opt;
      pendingGroup = null;
      continue;
    }
    // positional
    const required = /^<.+>$/.test(tok) && !optional;
    const pname = stripBrackets(tok);
    if (pname) positionals.push({ name: pname, kind: "positional", required });
    lastFlag = null;
    pendingGroup = null;
  }

  if (!options.length && !positionals.length) return { ...EMPTY };
  return { options, positionals, source: "argument-hint" };
}

/** Tier 2 — parse the `options:` frontmatter DSL (one option per line). */
export function parseOptionsFrontmatter(raw: string): CommandOptionsSpec {
  const options: CommandOption[] = [];
  const positionals: CommandOption[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
    if (!m) continue;
    const head = m[1];
    let rest = m[2].trim();
    let group: string | undefined;
    const gm = rest.match(/^\(([^)]+)\)\s*([\s\S]*)$/);
    if (gm) { group = gm[1].trim(); rest = gm[2].trim(); }
    const description = rest || undefined;

    if (isFlagToken(head)) {
      let name = head;
      let kind: CommandOptionKind = "flag";
      let valuePlaceholder: string | undefined;
      let choices: string[] | undefined;
      const eq = head.indexOf("=");
      if (eq !== -1) {
        name = head.slice(0, eq);
        const val = head.slice(eq + 1);
        if (val.includes("|")) { kind = "choice"; choices = val.split("|").filter(Boolean); }
        else { kind = "value"; valuePlaceholder = stripBrackets(val); }
      }
      const opt: CommandOption = { name, kind, required: false };
      if (valuePlaceholder) opt.valuePlaceholder = valuePlaceholder;
      if (choices) opt.choices = choices;
      if (group) opt.group = group;
      if (description) opt.description = description;
      options.push(opt);
    } else {
      const required = /^<.+>$/.test(head);
      const pname = stripBrackets(head);
      if (pname) {
        const p: CommandOption = { name: pname, kind: "positional", required };
        if (description) p.description = description;
        positionals.push(p);
      }
    }
  }
  return { options, positionals, source: "frontmatter" };
}

/** Precedence: explicit `options:` frontmatter wins, else the hint, else none. */
export function resolveCommandOptions(input: { optionsRaw?: string; argumentHint?: string }): CommandOptionsSpec {
  const raw = (input.optionsRaw ?? "").trim();
  if (raw) {
    const fm = parseOptionsFrontmatter(raw);
    if (fm.options.length || fm.positionals.length) return fm;
  }
  const hint = (input.argumentHint ?? "").trim();
  if (hint) {
    const h = parseArgumentHint(hint);
    if (h.options.length || h.positionals.length) return h;
  }
  return { ...EMPTY };
}
