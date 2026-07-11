/**
 * Mail Lane I/O against Apple Mail — self-contained (no IMAP/SMTP, no OAuth). Uses
 * accounts Mail.app already holds (Gmail + Outlook both work).
 *
 *   read:  osascript queries the inbox for recent messages (id > high-water).
 *   send:  osascript composes + sends; draft saves to Drafts for approval.
 *
 * The osascript output is a record-separated / unit-separated string; parsing it
 * (parseMailRecords / parseSender) is pure and unit-tested. The live Mail.app
 * interaction is verified on the real machine.
 */

import { execFile, execFileSync } from "child_process";
import { type InboundEmail } from "./contracts";

const RS = "\x1e"; // record separator
const US = "\x1f"; // unit separator

type OsascriptResult = { ok: boolean; stdout: string; stderr?: string; timedOut?: boolean };
type OsascriptRunner = (script: string, args: string[], timeoutMs: number) => Promise<OsascriptResult>;

function defaultOsascript(script: string, args: string[], timeoutMs: number): Promise<OsascriptResult> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      // execFile signals a timeout kill via err.killed + err.signal (SIGTERM by
      // default) — used to distinguish "Mail didn't respond" from a hard
      // AppleScript error (permission denied, not running, etc).
      const timedOut = !!err && (err as NodeJS.ErrnoException & { killed?: boolean; signal?: string }).killed === true;
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut });
    });
  });
}

function defaultIsMailAppRunning(): boolean {
  try {
    execFileSync("pgrep", ["-x", "Mail"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let osascriptRunner: OsascriptRunner = defaultOsascript;
let isMailAppRunningForApplemail: () => boolean = defaultIsMailAppRunning;

export function _setAppleMailDepsForTests(deps: { osascript?: OsascriptRunner; isMailAppRunning?: () => boolean } | null): void {
  osascriptRunner = deps?.osascript ?? defaultOsascript;
  isMailAppRunningForApplemail = deps?.isMailAppRunning ?? defaultIsMailAppRunning;
}

/** Split "Name <email@x>" or "email@x" into address + display name. */
export function parseSender(raw: string): { from: string; fromName: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { from: m[2].trim().toLowerCase(), fromName: m[1].trim() || null };
  return { from: raw.trim().toLowerCase(), fromName: null };
}

function toIso(dateStr: string): string {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Parse the RS/US-delimited osascript output into InboundEmail records. */
export function parseMailRecords(raw: string): InboundEmail[] {
  const out: InboundEmail[] = [];
  for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const [idStr, sender, subject, dateStr, attsStr, ...bodyParts] = rec.split(US);
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) continue;
    const { from, fromName } = parseSender(sender ?? "");
    out.push({
      id,
      from,
      fromName,
      subject: (subject ?? "").trim(),
      body: (bodyParts.join(US) ?? "").trim(),
      receivedAt: toIso(dateStr ?? ""),
      attachments: (attsStr ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

const READ_SCRIPT = `on run argv
  set sinceId to (item 1 of argv) as integer
  set maxN to (item 2 of argv) as integer
  set US to (ASCII character 31)
  set RS to (ASCII character 30)
  set outText to ""
  tell application "Mail"
    set msgs to messages of inbox
    set total to count of msgs
    set lim to maxN
    if total < lim then set lim to total
    repeat with i from 1 to lim
      set m to item i of msgs
      set mid to (id of m) as integer
      if mid > sinceId then
        set theSender to (sender of m) as string
        set theSubject to (subject of m) as string
        set theDate to (date received of m) as string
        set attNames to ""
        try
          repeat with a in (mail attachments of m)
            set attNames to attNames & (name of a) & ","
          end repeat
        end try
        set theBody to (content of m) as string
        if (length of theBody) > 4000 then set theBody to (text 1 thru 4000 of theBody)
        set outText to outText & mid & US & theSender & US & theSubject & US & theDate & US & attNames & US & theBody & RS
      end if
    end repeat
  end tell
  return outText
end run`;

/** Read inbox messages with id > sinceId (most-recent scan, capped at limit). */
export async function readInboxSince(sinceId: number, limit = 25, timeoutMs = 30_000): Promise<InboundEmail[]> {
  const res = await osascriptRunner(READ_SCRIPT, [String(sinceId), String(limit)], timeoutMs);
  if (!res.ok) return [];
  return parseMailRecords(res.stdout);
}

export type MailProbeKind = "granted" | "not_authorized" | "not_running" | "timeout" | "error";

export interface MailProbeResult {
  ok: boolean;
  kind: MailProbeKind;
  detail: string;
}

// AppleScript surfaces TCC/Automation denial as error -1743 ("not allowed to
// send Apple events"), and "Mail isn't running" as error -600 when a script
// explicitly avoids auto-launching it. Match on both the numeric code and the
// wording, since osascript's stderr format has drifted across macOS releases.
function classifyOsascriptFailure(stderr: string, timedOut: boolean): { kind: MailProbeKind; detail: string } {
  if (timedOut) {
    return { kind: "timeout", detail: "Mail did not respond in time." };
  }
  if (/-1743|not authorized|not allowed to send apple events/i.test(stderr)) {
    return {
      kind: "not_authorized",
      detail: 'HiveMatrix is not authorized to control Mail. Approve the "HiveMatrix wants to control Mail" prompt, or turn it on in System Settings → Privacy & Security → Automation.',
    };
  }
  if (/-600|isn.t running|is not running|application isn.t running/i.test(stderr)) {
    return { kind: "not_running", detail: "Mail.app is not running." };
  }
  return { kind: "error", detail: stderr.trim() || "Could not control Mail.app (unknown error)." };
}

/**
 * Explicit Apple Mail Automation probe that distinguishes WHY control failed
 * (not authorized vs. not running vs. timed out) instead of a bare boolean —
 * the setup UI needs the real reason to show something better than a generic
 * "approval needed" dead end. With allowLaunch, `tell application "Mail"`
 * both launches Mail and fires the AppleEvent that makes macOS register
 * HiveMatrix under Mail's Automation entry (it won't appear there otherwise).
 */
export async function probeAppleMail(timeoutMs = 8_000, opts: { allowLaunch?: boolean } = {}): Promise<MailProbeResult> {
  if (!opts.allowLaunch && !isMailAppRunningForApplemail()) {
    return { kind: "not_running", ok: false, detail: "Mail.app is not running." };
  }
  const res = await osascriptRunner(`tell application "Mail" to return (count of mailboxes)`, [], timeoutMs);
  if (res.ok) return { ok: true, kind: "granted", detail: "HiveMatrix can control Apple Mail." };
  const { kind, detail } = classifyOsascriptFailure(res.stderr ?? "", res.timedOut === true);
  return { ok: false, kind, detail };
}

/** Can we drive Mail.app (running + Automation permission granted)? */
export async function canControlMail(timeoutMs = 8_000, opts: { allowLaunch?: boolean } = {}): Promise<boolean> {
  return (await probeAppleMail(timeoutMs, opts)).ok;
}

// argv: to, subject, body, "send"|"draft", then 0+ attachment file paths.
const SEND_SCRIPT = `on run argv
  set toAddr to item 1 of argv
  set subj to item 2 of argv
  set bodyText to item 3 of argv
  set doSend to (item 4 of argv)
  tell application "Mail"
    set newMsg to make new outgoing message with properties {subject:subj, content:bodyText, visible:true}
    tell newMsg to make new to recipient at end of to recipients with properties {address:toAddr}
    if (count of argv) > 4 then
      repeat with i from 5 to (count of argv)
        try
          tell newMsg to make new attachment with properties {file name:(POSIX file (item i of argv))} at after the last paragraph of content
        end try
      end repeat
      delay 1
    end if
    if doSend is "send" then
      send newMsg
    else
      save newMsg
    end if
  end tell
end run`;

/** Send an email via Mail.app, optionally with file attachments. Resolves false on failure. */
export function sendMail(to: string, subject: string, body: string, attachments: string[] = [], timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", SEND_SCRIPT, to, subject, body, "send", ...attachments], { timeout: timeoutMs }, (err) => resolve(!err));
  });
}

/** Save a draft reply (with optional attachments) to Drafts for human approval. */
export function draftMail(to: string, subject: string, body: string, attachments: string[] = [], timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", SEND_SCRIPT, to, subject, body, "draft", ...attachments], { timeout: timeoutMs }, (err) => resolve(!err));
  });
}
