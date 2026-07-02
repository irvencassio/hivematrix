/**
 * Mail Lane poller — watch the inbox and route new mail into Flash Lane (known
 * senders) or triage tasks (unknown + triage-all). Runs inside the daemon; gated
 * by the channel being enabled. Email is lower-frequency than SMS and Mail.app
 * osascript is slow, so the interval is generous.
 *
 * The flashDispatch callback is injected by daemon/index.ts (only daemon/ imports
 * from flash/) — falls back to a no-op if not wired.
 */

import { homedir } from "os";
import { Task } from "@/lib/db";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import { routeEmail } from "./handoff";
import { readInboxSince, sendMail } from "./applemail";
import { looksLikeAuthRequest, replySubject } from "./delivery";
import {
  isChannelEnabled, getLastId, setLastId, isKnownSender,
  isAuthenticatedDomain, triageAll, recordInbound, recordError,
} from "./store";

const POLL_INTERVAL_MS = 30_000;

/** Injected by daemon/index.ts; accepts (flashText, peer) and returns the Flash reply. */
type FlashDispatch = (text: string, peer: string) => Promise<string>;
let flashDispatch: FlashDispatch | null = null;

export async function pollOnce(): Promise<void> {
  if (!isChannelEnabled()) return;
  try {
    const since = getLastId();
    const emails = await readInboxSince(since, 25);
    let maxId = since;
    // Process oldest-first so session order matches arrival.
    for (const email of [...emails].sort((a, b) => a.id - b.id)) {
      maxId = Math.max(maxId, email.id);
      const route = routeEmail(email, {
        knownSender: isKnownSender(email.from),
        authenticatedDomain: isAuthenticatedDomain(email.from),
        triageAll: triageAll(),
      });

      if (route.kind === "flash_turn") {
        // Dispatch to Flash Lane; send reply via Mail Lane if trusted + no auth hallucination.
        if (flashDispatch) {
          try {
            const reply = await flashDispatch(route.flashText, route.peer);
            if (reply.trim() && route.autoSendEligible && !looksLikeAuthRequest(reply)) {
              await sendMail(route.peer, replySubject(route.subject), reply);
            }
          } catch (err) {
            recordError(`flash dispatch failed for mail from ${route.peer}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        recordInbound();
        continue;
      }

      if (route.kind !== "new_task") continue;
      await Task.create({
        title: route.title,
        description: route.description,
        project: DEFAULT_TASK_PROJECT,
        projectPath: homedir(),
        status: "backlog",
        executor: "agent",
        source: "mailbee",
        output: {
          mailbee: {
            from: email.from,
            subject: email.subject,
            trust: route.trust.level,
            autoSendEligible: route.autoSendEligible,
            messageId: email.id,
          },
        },
      });
      recordInbound();
    }
    if (maxId > since) setLastId(maxId);
  } catch (err) {
    recordError(err instanceof Error ? err.message : String(err));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startMailBeePoller(intervalMs = POLL_INTERVAL_MS, dispatch?: FlashDispatch): () => void {
  flashDispatch = dispatch ?? null;
  if (timer) return stopMailBeePoller;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pollOnce().finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopMailBeePoller;
}

export function stopMailBeePoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
