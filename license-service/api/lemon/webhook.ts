/**
 * POST /api/lemon/webhook
 *
 * Stateless Lemon Squeezy webhook receiver. Verifies the HMAC-SHA256 signature,
 * signs a Pro license payload with the operator's Ed25519 private key, and
 * emails it via Resend. No database — the payment provider is the source of truth.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildPayload, isAnnualVariant, signLicense } from "../../lib/signing";
import { sendLicenseEmail } from "../../lib/email";
import type { LemonOrderAttrs, LemonSubAttrs } from "../../lib/types";

// Raw body required for HMAC verification — disable Vercel's body parser.
export const config = { api: { bodyParser: false } };

function readBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifySignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookSecret = process.env.LEMON_WEBHOOK_SECRET;
  const privateKeyPem = process.env.HIVEMATRIX_LICENSE_PRIVATE_KEY_PEM;
  if (!webhookSecret || !privateKeyPem) {
    console.error("[license-service] Missing required env vars");
    return res.status(500).json({ error: "service misconfigured" });
  }

  const rawBody = await readBody(req);
  const sig = req.headers["x-signature"] as string | undefined;
  if (!sig || !verifySignature(rawBody, sig, webhookSecret)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(rawBody.toString("utf8")) as {
    meta: { event_name: string };
    data: { attributes: Record<string, unknown> };
  };
  const eventName = event.meta?.event_name;
  const attrs = event.data?.attributes ?? {};

  if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
    // Grace period on the client handles degradation — no action here.
    console.log(`[license-service] ${eventName} for ${attrs.user_email} — grace period applies`);
    return res.status(200).json({ received: true });
  }

  if (eventName !== "order_created" && eventName !== "subscription_payment_success") {
    return res.status(200).json({ received: true, skipped: eventName });
  }

  let email: string;
  let name: string;
  let variantId: number;

  if (eventName === "order_created") {
    const a = attrs as unknown as LemonOrderAttrs;
    email = a.user_email;
    name = a.user_name ?? "";
    variantId = a.first_order_item?.variant_id ?? 0;
  } else {
    const a = attrs as unknown as LemonSubAttrs;
    email = a.user_email;
    name = a.user_name ?? "";
    variantId = a.variant_id;
  }

  if (!email) {
    console.error("[license-service] Missing user_email in webhook payload");
    return res.status(400).json({ error: "missing user_email" });
  }

  const annual = isAnnualVariant(variantId);
  const payload = buildPayload(email, name, annual);
  const signed = signLicense(payload, privateKeyPem);
  await sendLicenseEmail(email, name, signed, annual ? "annual" : "monthly");

  console.log(`[license-service] License issued — ${email}, expires ${payload.expiresAt}`);
  return res.status(200).json({ issued: true, email, expiresAt: payload.expiresAt });
}
