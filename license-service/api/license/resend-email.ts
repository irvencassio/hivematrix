/**
 * POST /api/license/resend-email
 *
 * Lets a customer request their license to be re-emailed. Queries the Lemon
 * Squeezy API to confirm an active subscription before issuing. Returns 200
 * regardless of whether the email exists to prevent enumeration.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildPayload, isAnnualVariant, signLicense } from "../../lib/signing";
import { sendLicenseEmail } from "../../lib/email";
import type { LemonSubAttrs } from "../../lib/types";

interface LemonApiResponse {
  data?: Array<{ attributes: LemonSubAttrs }>;
}

async function findActiveSub(email: string): Promise<{ attrs: LemonSubAttrs } | null> {
  const apiKey = process.env.LEMON_API_KEY;
  if (!apiKey) return null;

  const url =
    `https://api.lemonsqueezy.com/v1/subscriptions` +
    `?filter[user_email]=${encodeURIComponent(email)}&filter[status]=active`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/vnd.api+json" },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as LemonApiResponse;
  const first = body.data?.[0];
  return first ? { attrs: first.attributes } : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "valid email required" });
  }

  const privateKeyPem = process.env.HIVEMATRIX_LICENSE_PRIVATE_KEY_PEM;
  if (!privateKeyPem) {
    return res.status(500).json({ error: "service misconfigured" });
  }

  // Always return 200 to prevent email enumeration; license only arrives if active.
  const sub = await findActiveSub(email).catch(() => null);
  if (!sub) {
    console.log(`[license-service] resend-email: no active sub found for ${email}`);
    return res.status(200).json({ queued: true });
  }

  const { variant_id, user_name } = sub.attrs;
  const annual = isAnnualVariant(variant_id);
  const payload = buildPayload(email, user_name ?? "", annual);
  const signed = signLicense(payload, privateKeyPem);
  await sendLicenseEmail(email, user_name ?? "", signed, annual ? "annual" : "monthly");

  console.log(`[license-service] License resent — ${email}`);
  return res.status(200).json({ queued: true });
}
