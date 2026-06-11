/**
 * Centralized constants/regexes for turn analysis. Edit here; call sites
 * stay tidy. Bump CURRENT_SIGNAL_VERSION whenever rules change so stored
 * signals get lazily re-derived on read.
 */

export const CURRENT_SIGNAL_VERSION = 1;

// Content caps — reuse existing TOOL_RESULT_MAX_CHARS for tools; text allows more.
export const TOOL_CONTENT_MAX_CHARS = 2000;
export const ASSISTANT_TEXT_MAX_CHARS = 20_000;
export const THINKING_MAX_CHARS = 5_000;
export const ERROR_MAX_CHARS = 2_000;

// Time-based close fallback for turns whose stream dried up without a stop event.
export const QUIET_CLOSE_MS = 2_000;

// Labeling
export const LABEL_MAX_CHARS = 60;
export const THINKING_LABEL_MAX = 40;
export const ERROR_LABEL_MAX = 80;
export const TOOL_ARG_LABEL_MAX = 40;

// Question detection
export const QUESTION_STARTERS = /^(what|which|how|should|do|does|can|could|would|will|is|are|did|have|has|shall|may|might)\b/i;
export const QUESTION_REBUTTAL = /^(because|yes[\s,—-]|no[\s,—-]|actually[\s,—-]|right[\s,—-]|correct[\s,—-]|indeed)/i;
export const MIN_QUESTION_CHARS = 10;
export const MIN_QUESTION_WORDS = 3;

// Final-answer markers
export const FINAL_ANSWER_MARKERS = /\b(in conclusion|in summary|to summarize|summary:|done\.|completed\.|shipped\.|pushed\.|merged\.|pr #?\d+|all set|all done)\b/i;

// Budget / failure markers (kept in sync with agent-manager.detectTransientFailure)
export const BUDGET_WARNING = /\b(rate limit|context window|overloaded|out of extra usage|token.*expired|not logged in|please run \/login)\b/i;

// Truncation heuristic: content that doesn't end with terminal punctuation.
export const TERMINAL_PUNCTUATION = /[.!?"')\]}]\s*$/;
