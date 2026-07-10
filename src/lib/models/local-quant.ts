/**
 * The Rapid-MLX model/quant catalog — a HuggingFace-style list of options, not a
 * fit solver. RAM gates which models are OFFERED (fast at ≥32GB, coding
 * additionally at ≥64GB); within that, the operator picks the quant.
 *
 * Download sizes are a static table, not computed. `rapid-mlx info` doesn't
 * report size and `rapid-mlx ls` reports the on-disk HF-cache footprint at
 * roughly 2x the download (blob + snapshot) — neither is a safe substitute.
 * Sizes below are HuggingFace API `sum(siblings[].size)` for each
 * mlx-community repo, probed 2026-07-09.
 */

import type { TierKey } from "./local-engine";

export type LocalQuant = "4bit" | "6bit" | "8bit";
export const LOCAL_QUANTS: LocalQuant[] = ["4bit", "6bit", "8bit"];

/** Minimum detected RAM (GB) for a tier to be offered at all. */
export const TIER_MIN_RAM_GB: Record<TierKey, number> = { fast: 32, coding: 64 };

/** The operator's picks: which tiers to install and at what quant. A tier key
 * absent (or null) means "not selected" — not "use the default". */
export type LocalSelection = Partial<Record<TierKey, LocalQuant | null>>;

export interface LocalModelOption {
  tier: TierKey;
  quant: LocalQuant;
  /** What we store in LocalTier.alias and pass to `rapid-mlx serve`/`pull`. */
  alias: string;
  /** Full HF repo id — display only. */
  repo: string;
  /** HF API download size, GiB. See module header for provenance. */
  downloadGiB: number;
}

export const LOCAL_MODEL_CATALOG: LocalModelOption[] = [
  { tier: "fast", quant: "4bit", alias: "qwen3.6-35b-4bit", repo: "mlx-community/Qwen3.6-35B-A3B-4bit", downloadGiB: 19.0 },
  { tier: "fast", quant: "6bit", alias: "qwen3.6-35b-6bit", repo: "mlx-community/Qwen3.6-35B-A3B-6bit", downloadGiB: 27.1 },
  { tier: "fast", quant: "8bit", alias: "qwen3.6-35b-8bit", repo: "mlx-community/Qwen3.6-35B-A3B-8bit", downloadGiB: 35.2 },
  { tier: "coding", quant: "4bit", alias: "qwen3.6-27b-4bit", repo: "mlx-community/Qwen3.6-27B-4bit", downloadGiB: 15.0 },
  { tier: "coding", quant: "6bit", alias: "qwen3.6-27b-6bit", repo: "mlx-community/Qwen3.6-27B-6bit", downloadGiB: 21.2 },
  { tier: "coding", quant: "8bit", alias: "qwen3.6-27b-8bit", repo: "mlx-community/Qwen3.6-27B-8bit", downloadGiB: 27.5 },
];

/** The models offered at this RAM: fast only below 64GB, both at 64GB+, none below 32GB. */
export function optionsForRam(ramGB: number): LocalModelOption[] {
  return LOCAL_MODEL_CATALOG.filter((opt) => ramGB >= TIER_MIN_RAM_GB[opt.tier]);
}

export function optionFor(tier: TierKey, quant: LocalQuant): LocalModelOption | null {
  return LOCAL_MODEL_CATALOG.find((opt) => opt.tier === tier && opt.quant === quant) ?? null;
}

/** Parses both the short alias (qwen3.6-35b-8bit) and the full repo id
 * (mlx-community/Qwen3.6-35B-A3B-8bit) — the quant suffix is identical in both. */
export function quantForAlias(alias: string): LocalQuant | null {
  const m = alias.match(/-([468])bit$/i);
  if (!m) return null;
  const quant = `${m[1]}bit` as LocalQuant;
  return LOCAL_QUANTS.includes(quant) ? quant : null;
}

/** Untrusted request-body shape: keys present but not yet typechecked. */
export type LocalSelectionInput = Partial<Record<TierKey, unknown>>;

export type SelectionValidation =
  | { ok: true; selection: LocalSelection }
  | { ok: false; error: string };

/**
 * Validates a raw (untrusted) selection payload against what this RAM band
 * actually offers — pure, no I/O, so the HTTP layer can stay a thin
 * parse-then-branch. A tier key set to `null` explicitly deselects it; a tier
 * key omitted is left untouched by the caller (merge semantics live in
 * setLocalEngineSelection, not here).
 */
export function validateSelection(raw: LocalSelectionInput, ramGB: number): SelectionValidation {
  const offered = optionsForRam(ramGB);
  const selection: LocalSelection = {};
  for (const key of Object.keys(raw) as TierKey[]) {
    if (key !== "fast" && key !== "coding") continue;
    const v = raw[key];
    if (v === undefined) continue;
    if (v === null) { selection[key] = null; continue; }
    if (typeof v !== "string" || !LOCAL_QUANTS.includes(v as LocalQuant)) {
      return { ok: false, error: `invalid quant for ${key}: ${JSON.stringify(v)}` };
    }
    if (!offered.some((o) => o.tier === key && o.quant === v)) {
      return { ok: false, error: `${key}@${v} needs at least ${TIER_MIN_RAM_GB[key]}GB RAM (detected ${Math.round(ramGB)}GB)` };
    }
    selection[key] = v as LocalQuant;
  }
  return { ok: true, selection };
}
