/**
 * Minimal Telegram Bot client — dependency-free (plain fetch, no grammy).
 * Used for outbound nudges with inline action buttons (retry/skip/abort,
 * approve/deny) and for reading the founder's button taps / replies back.
 *
 * Security: a hard allowlist (configured chat id + user ids). Every update whose
 * chat or sender isn't allowlisted is dropped.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface TelegramConfig {
  botToken: string;
  chatId: number;
  allowedUserIds: number[];
}

export function getTelegramConfig(): TelegramConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const t = cfg?.telegram;
    if (!t?.botToken || typeof t.chatId !== "number" || !Array.isArray(t.allowedUserIds) || t.allowedUserIds.length === 0) {
      return null;
    }
    return { botToken: String(t.botToken), chatId: t.chatId, allowedUserIds: t.allowedUserIds.map(Number) };
  } catch {
    return null;
  }
}

export interface InlineButton { text: string; data: string }

/** A reply_markup inline keyboard from rows of {text, callback_data}. */
export function inlineKeyboard(rows: InlineButton[][]): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

// callback_data uses "|" not ":" — stuck timestamps are ISO strings full of colons.
/** Buttons for a stuck task: data = "stuck|<taskId>|<timestamp>|<decision>". */
export function stuckKeyboard(taskId: string, timestamp: string) {
  return inlineKeyboard([[
    { text: "↻ Retry", data: `stuck|${taskId}|${timestamp}|retry` },
    { text: "⏭ Skip", data: `stuck|${taskId}|${timestamp}|skip` },
    { text: "✖ Abort", data: `stuck|${taskId}|${timestamp}|abort` },
  ]]);
}

/** Buttons for an approval: data = "approval|<taskId>|<timestamp>|<decision>". */
export function approvalKeyboard(taskId: string, timestamp: string) {
  return inlineKeyboard([[
    { text: "✅ Approve", data: `approval|${taskId}|${timestamp}|approve` },
    { text: "🚫 Deny", data: `approval|${taskId}|${timestamp}|denied` },
  ]]);
}

export interface ParsedCallback {
  kind: "stuck" | "approval";
  id: string;
  timestamp: string;
  decision: string;
}

/** Parse "<kind>|<id>|<timestamp>|<decision>" callback data. */
export function parseCallbackData(data: string): ParsedCallback | null {
  const parts = data.split("|");
  if (parts.length !== 4) return null;
  const [kind, id, timestamp, decision] = parts;
  if (kind !== "stuck" && kind !== "approval") return null;
  if (!id || !timestamp || !decision) return null;
  return { kind, id, timestamp, decision };
}

async function api(cfg: TelegramConfig, method: string, body: unknown, timeoutMs = 30_000): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json().catch(() => ({}));
}

export async function sendTelegram(cfg: TelegramConfig, text: string, replyMarkup?: unknown): Promise<boolean> {
  try {
    const r = await api(cfg, "sendMessage", { chat_id: cfg.chatId, text, reply_markup: replyMarkup }) as { ok?: boolean };
    return r?.ok === true;
  } catch {
    return false;
  }
}

export async function answerCallback(cfg: TelegramConfig, callbackQueryId: string, text: string): Promise<void> {
  try { await api(cfg, "answerCallbackQuery", { callback_query_id: callbackQueryId, text }, 10_000); } catch { /* ignore */ }
}

export async function editMessageText(cfg: TelegramConfig, messageId: number, text: string): Promise<void> {
  try { await api(cfg, "editMessageText", { chat_id: cfg.chatId, message_id: messageId, text }, 10_000); } catch { /* ignore */ }
}

export interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { message_id?: number; chat?: { id?: number } };
  };
  message?: { text?: string; from?: { id?: number }; chat?: { id?: number } };
}

/** Long-poll for updates after `offset`. Returns [] on error. */
export async function getUpdates(cfg: TelegramConfig, offset: number, timeoutSec = 25): Promise<TelegramUpdate[]> {
  try {
    const r = await api(cfg, "getUpdates", { offset, timeout: timeoutSec }, (timeoutSec + 5) * 1000) as { ok?: boolean; result?: TelegramUpdate[] };
    return r?.ok && Array.isArray(r.result) ? r.result : [];
  } catch {
    return [];
  }
}

/** Is this update from the allowlisted chat + an allowlisted user? */
export function isAuthorizedUpdate(cfg: TelegramConfig, u: TelegramUpdate): boolean {
  const from = u.callback_query?.from?.id ?? u.message?.from?.id;
  const chat = u.callback_query?.message?.chat?.id ?? u.message?.chat?.id;
  return !!from && cfg.allowedUserIds.includes(from) && chat === cfg.chatId;
}
