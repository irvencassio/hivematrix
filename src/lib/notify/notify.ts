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
import { isChannelEnabled as isMessageLaneEnabled } from "@/lib/messagebee/store";
import { isChannelEnabled as isMailLaneEnabled } from "@/lib/mailbee/store";

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

export interface NotifyDeps {
  getTelegramConfig: typeof getTelegramConfig;
  readNotifyConfig: () => NotifyConfig;
  isMessageLaneEnabled: () => boolean;
  isMailLaneEnabled: () => boolean;
  sendTelegram: typeof sendTelegram;
  sendIMessage: typeof sendIMessage;
  sendMail: typeof sendMail;
}

const defaultNotifyDeps: NotifyDeps = {
  getTelegramConfig,
  readNotifyConfig,
  isMessageLaneEnabled,
  isMailLaneEnabled,
  sendTelegram,
  sendIMessage,
  sendMail,
};

/**
 * Send a notification to every configured channel. `telegramMarkup` attaches an
 * inline keyboard to the Telegram message only (other channels are text-only).
 */
export async function notify(
  text: string,
  opts: { telegramMarkup?: unknown } = {},
  deps: NotifyDeps = defaultNotifyDeps,
): Promise<NotifyResult> {
  const tgCfg = deps.getTelegramConfig();
  const targets = resolveNotifyTargets(deps.readNotifyConfig(), tgCfg !== null);
  const messageTarget = targets.imessage && deps.isMessageLaneEnabled() ? targets.imessage : null;
  const mailTarget = targets.email && deps.isMailLaneEnabled() ? targets.email : null;

  const [telegram, imessage, email] = await Promise.all([
    targets.telegram && tgCfg ? deps.sendTelegram(tgCfg, text, opts.telegramMarkup) : Promise.resolve(false),
    messageTarget ? deps.sendIMessage(messageTarget, text) : Promise.resolve(false),
    mailTarget ? deps.sendMail(mailTarget, "HiveMatrix", text) : Promise.resolve(false),
  ]);

  return { telegram, imessage, email, anySent: telegram || imessage || email };
}
