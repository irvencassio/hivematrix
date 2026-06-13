import { sendMail as defaultSendMail } from "./applemail";

type SendMail = (to: string, subject: string, body: string) => Promise<boolean>;

export interface MailBeeDeliveryTask {
  _id: string;
  source?: string | null;
  output?: Record<string, unknown> | null;
}

export interface MailBeeDeliveryOptions {
  reviewState?: string | null;
  sendMail?: SendMail;
  now?: () => string;
}

export interface MailBeeDeliveryResult {
  sent: boolean;
  reason: string;
  output: Record<string, unknown>;
}

interface MailBeeOutput {
  from?: unknown;
  subject?: unknown;
  trust?: unknown;
  autoSendEligible?: unknown;
  sentAt?: unknown;
  delivery?: unknown;
}

function asMailBeeOutput(output: Record<string, unknown>): MailBeeOutput {
  const raw = output.mailbee;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as MailBeeOutput : {};
}

function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Re: your email";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function withMailBee(output: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...output,
    mailbee: {
      ...asMailBeeOutput(output),
      ...patch,
    },
  };
}

export async function deliverTrustedMailBeeReply(
  task: MailBeeDeliveryTask,
  options: MailBeeDeliveryOptions = {},
): Promise<MailBeeDeliveryResult> {
  const output = { ...(task.output ?? {}) };
  const mailbee = asMailBeeOutput(output);

  if (task.source !== "mailbee") return { sent: false, reason: "not_mailbee", output };
  if (options.reviewState === "needs_input") return { sent: false, reason: "needs_input", output };
  if (mailbee.sentAt) return { sent: false, reason: "already_sent", output };
  if (mailbee.autoSendEligible !== true || mailbee.trust !== "trusted") {
    return { sent: false, reason: "not_auto_send_eligible", output };
  }

  const to = typeof mailbee.from === "string" ? mailbee.from.trim() : "";
  const subject = typeof mailbee.subject === "string" ? mailbee.subject : "";
  const body = typeof output.summary === "string" ? output.summary.trim() : "";
  if (!to) return { sent: false, reason: "missing_recipient", output };
  if (!body) return { sent: false, reason: "missing_summary", output };

  const sendMail = options.sendMail ?? defaultSendMail;
  const now = options.now ?? (() => new Date().toISOString());
  const sent = await sendMail(to, replySubject(subject), body);
  const stamp = now();
  const nextOutput = withMailBee(output, sent
    ? { delivery: "sent", sentAt: stamp }
    : { delivery: "send_failed", sendFailedAt: stamp });
  return { sent, reason: sent ? "sent" : "send_failed", output: nextOutput };
}
