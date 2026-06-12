/**
 * Unified outbound notification plane: notify(text) fans out to whichever
 * channels the operator configured (Telegram, iMessage, email). One call,
 * many surfaces — so escalations (stuck tasks, approvals, directive failures,
 * usage exhaustion) reach the founder wherever they are.
 *
 * Config (`~/.hivematrix/config.json`):
 *   notify: { channels: ["telegram","imessage","email"], ownerHandle, ownerEmail }
 * Telegram also requires its own `telegram` block (see telegram.ts).
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getTelegramConfig, sendTelegram } from "./telegram";
import { sendIMessage } from "@/lib/messagebee/imessage";
import { sendMail } from "@/lib/mailbee/applemail";

export interface NotifyTargets {
  telegram: boolean;
  imessage: string | null; // owner handle
  email: string | null;    // owner address
}

interface NotifyConfig {
  channels?: string[];
  ownerHandle?: string;
  ownerEmail?: string;
}

/** Pure: resolve which channels/targets a notify() should hit, from config. */
export function resolveNotifyTargets(
  notifyCfg: NotifyConfig,
  telegramConfigured: boolean,
): NotifyTargets {
  const channels = new Set((notifyCfg.channels ?? []).map((c) => c.toLowerCase()));
  return {
    telegram: channels.has("telegram") && telegramConfigured,
    imessage: channels.has("imessage") && notifyCfg.ownerHandle ? notifyCfg.ownerHandle : null,
    email: channels.has("email") && notifyCfg.ownerEmail ? notifyCfg.ownerEmail : null,
  };
}

function readNotifyConfig(): NotifyConfig {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    return (cfg?.notify as NotifyConfig) ?? {};
  } catch {
    return {};
  }
}

export interface NotifyResult { telegram: boolean; imessage: boolean; email: boolean; anySent: boolean }

/**
 * Send a notification to every configured channel. `telegramMarkup` attaches an
 * inline keyboard to the Telegram message only (other channels are text-only).
 */
export async function notify(text: string, opts: { telegramMarkup?: unknown } = {}): Promise<NotifyResult> {
  const tgCfg = getTelegramConfig();
  const targets = resolveNotifyTargets(readNotifyConfig(), tgCfg !== null);

  const [telegram, imessage, email] = await Promise.all([
    targets.telegram && tgCfg ? sendTelegram(tgCfg, text, opts.telegramMarkup) : Promise.resolve(false),
    targets.imessage ? sendIMessage(targets.imessage, text) : Promise.resolve(false),
    targets.email ? sendMail(targets.email, "HiveMatrix", text) : Promise.resolve(false),
  ]);

  return { telegram, imessage, email, anySent: telegram || imessage || email };
}
