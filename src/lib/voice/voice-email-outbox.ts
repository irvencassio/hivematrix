/**
 * Voice-email outbox watcher — polls ~/.hivematrix/voice-email-outbox/ for email
 * metadata JSON files produced by voice_email.py or turn_server.py /email endpoint,
 * and sends each one via Apple Mail (sendMail / draftMail).
 *
 * Integration path (from voice_email.py comments):
 *   Short-term: standalone script, callable from HiveMatrix as a tool/skill
 *   Medium-term: POST /voice/email endpoint on turn_server.py
 *   Long-term: Voice Lane email skill via Talk button → daemon outbox → mail_send
 *
 * This poller implements the daemon-side half of the medium-term path: the turn
 * server's /email endpoint writes JSON to the outbox, and this poller picks it up
 * and sends it through Apple Mail via the existing mailbee AppleScript layer.
 */

import { readdirSync, readFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { sendMail, draftMail } from "@/lib/mailbee/applemail";

const OUTBOX_DIR = join(homedir(), ".hivematrix", "voice-email-outbox");
const POLL_INTERVAL_MS = 5_000; // fast — voice dictation is interactive

// Track files we've already seen to avoid re-sending on restart
const seen = new Set<string>();

/** Injectable send/draft functions for testing. When null, uses real applemail. */
type MailFn = (to: string, subject: string, body: string) => Promise<boolean>;
let _injectSend: MailFn | null = null;
let _injectDraft: MailFn | null = null;

/** Override the send/draft implementations for testing. Pass null to restore real ones. */
export function _setVoiceEmailMailFnsForTests(send: MailFn | null, draft: MailFn | null): void {
  _injectSend = send;
  _injectDraft = draft;
}

async function doSend(to: string, subject: string, body: string): Promise<boolean> {
  if (_injectSend) return _injectSend(to, subject, body);
  return sendMail(to, subject, body);
}

async function doDraft(to: string, subject: string, body: string): Promise<boolean> {
  if (_injectDraft) return _injectDraft(to, subject, body);
  return draftMail(to, subject, body);
}

export async function pollVoiceEmailOutbox(): Promise<void> {
  if (!existsSync(OUTBOX_DIR)) return;
  try {
    const entries = readdirSync(OUTBOX_DIR);
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      const path = join(OUTBOX_DIR, entry);
      try {
        const raw = readFileSync(path, "utf8");
        const data = JSON.parse(raw);
        const to = String(data.to ?? "").trim();
        const subject = String(data.subject ?? "").trim();
        const body = String(data.body ?? "").trim();
        const sendMode = String(data.sendMode ?? "send").trim(); // "send" | "draft"

        if (!to || !body) {
          console.warn(`[voice-email] skipping ${entry}: missing to or body`);
          unlinkSync(path);
          continue;
        }

        if (sendMode === "draft") {
          await doDraft(to, subject, body);
          console.log(`[voice-email] drafted to ${to}: "${subject || '(no subject)'}"`);
        } else {
          await doSend(to, subject, body);
          console.log(`[voice-email] sent to ${to}: "${subject || '(no subject)'}"`);
        }

        // Remove the file after successful send
        unlinkSync(path);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[voice-email] failed to process ${entry}: ${msg}`);
        // Move to a failed subdirectory to avoid retry loops
        const failedDir = join(OUTBOX_DIR, "failed");
        mkdirSync(failedDir, { recursive: true });
        renameSync(path, join(failedDir, entry));
      }
    }
  } catch (err) {
    console.error(`[voice-email] poll error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startVoiceEmailOutboxPoller(intervalMs = POLL_INTERVAL_MS): () => void {
  if (timer) return stopVoiceEmailOutboxPoller;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pollVoiceEmailOutbox()
      .catch((e) => { console.error(`[voice-email] poll failed: ${e instanceof Error ? e.message : e}`); })
      .finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopVoiceEmailOutboxPoller;
}

export function stopVoiceEmailOutboxPoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
