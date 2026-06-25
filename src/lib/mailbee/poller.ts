/**
 * Mail Lane poller — watch the inbox and turn new mail into trust-classified
 * triage tasks. Runs inside the daemon; gated by the channel being enabled.
 * Email is lower-frequency than SMS and Mail.app osascript is slow, so the
 * interval is generous.
 */

import { homedir } from "os";
import { Task } from "@/lib/db";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import { routeEmail } from "./handoff";
import { readInboxSince } from "./applemail";
import {
  isChannelEnabled, getLastId, setLastId, isKnownSender,
  isAuthenticatedDomain, triageAll, recordInbound, recordError,
} from "./store";

const POLL_INTERVAL_MS = 30_000;

export async function pollOnce(): Promise<void> {
  if (!isChannelEnabled()) return;
  try {
    const since = getLastId();
    const emails = await readInboxSince(since, 25);
    let maxId = since;
    // Process oldest-first so task order matches arrival.
    for (const email of [...emails].sort((a, b) => a.id - b.id)) {
      maxId = Math.max(maxId, email.id);
      const route = routeEmail(email, {
        knownSender: isKnownSender(email.from),
        authenticatedDomain: isAuthenticatedDomain(email.from),
        triageAll: triageAll(),
      });
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

export function startMailBeePoller(intervalMs = POLL_INTERVAL_MS): () => void {
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
