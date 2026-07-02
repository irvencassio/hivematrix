# Lemon Squeezy Store Setup — Operator Runbook

> **⚑ OPERATOR ACTION REQUIRED** — This document cannot be executed by an automated agent.
> It requires a human to sign up for a Lemon Squeezy merchant account.
>
> Estimated time: 30–45 minutes. Prerequisites: a business name, bank account for payouts,
> and a VAT/tax ID if you have one (Lemon Squeezy handles sales tax as merchant-of-record).

---

## 1. Why Lemon Squeezy

Lemon Squeezy is the chosen payment provider (decided 2026-07-02) because:
- It acts as **merchant of record** — it handles global sales tax/VAT, no tax filing per country.
- Built for prosumer/indie SaaS exactly at this price point.
- Webhook payload is simple; license issuance service stays under 300 lines.
- No per-seat pricing, no enterprise overhead.

---

## 2. Account Creation

1. Go to **https://www.lemonsqueezy.com** → click **Start for free**.
2. Sign up with `cassio.irv@gmail.com` (the operator email).
3. Verify your email address.
4. Complete onboarding: store name = **HiveMatrix**, currency = **USD**.
5. Under **Settings → Store**, set:
   - **Store URL slug:** `hivematrix`
   - **Support email:** your support contact (used in customer receipts)
   - **Logo:** upload the HiveMatrix app icon (512×512 PNG)
6. Under **Settings → Payouts**, connect your bank account. Lemon Squeezy requires this before test mode purchases can be withdrawn; you can complete it post-launch.

---

## 3. Create the Two Subscription Products

### Product 1 — Pro Monthly

1. **Products → Add product** → type: **Subscription**
2. Fill in:
   | Field | Value |
   |---|---|
   | Name | HiveMatrix Pro |
   | Slug | `hivematrix-pro-monthly` |
   | Description | Unlimited autonomous AI lanes, voice, channels, and companion pairing on your Mac. No credits. No per-task fees. |
   | Price | **$39.00 / month** |
   | Billing interval | Monthly |
   | Trial days | 0 (no free trial in v1) |
   | Tax category | **SaaS / software** |
3. Under **Checkout**, enable **"Require billing address"** (needed for tax).
4. Set **Confirmation redirect URL** to `https://hivematrix.app/activate?source=checkout` (adjust to real domain when known).
5. Save. Note the **Product ID** and **Variant ID** — you'll need them in step 5.

### Product 2 — Pro Annual

1. **Products → Add product** → type: **Subscription**
2. Fill in:
   | Field | Value |
   |---|---|
   | Name | HiveMatrix Pro — Annual |
   | Slug | `hivematrix-pro-annual` |
   | Description | HiveMatrix Pro, billed annually. Save 25% vs monthly. |
   | Price | **$349.00 / year** |
   | Billing interval | Yearly |
   | Trial days | 0 |
   | Tax category | **SaaS / software** |
3. Same checkout settings as above.
4. Confirmation redirect URL: same as above.
5. Save. Note the **Product ID** and **Variant ID**.

---

## 4. Configure the Webhook

1. Go to **Settings → Webhooks → Add webhook**.
2. Set:
   | Field | Value |
   |---|---|
   | URL | `https://<your-license-service-domain>/api/lemon/webhook` |
   | Secret | Generate a random 32-byte secret: `openssl rand -hex 32` — save it securely |
   | Events | Check: `order_created`, `subscription_payment_success`, `subscription_cancelled`, `subscription_expired` |
3. Save. Copy the **Signing Secret** — this goes into `LEMON_WEBHOOK_SECRET` env var.

> **Note:** If the license service domain isn't live yet, you can set a placeholder URL and update it
> after P3.2 (license service) is deployed. Webhooks can be retried from the Lemon Squeezy dashboard.

---

## 5. Collect the API Key

1. **Settings → API → Create API key** → name it `hivematrix-license-service`.
2. Copy the key — it starts with `eyJ...` (a JWT).
3. This key is **only needed** if the license service ever calls the Lemon Squeezy API to verify
   subscription status directly (optional; webhook-only operation doesn't require it).
4. Store it in your secure vault regardless — it's easier to have than to regenerate later.

---

## 6. Environment Variables Required by the License Service

The webhook receiver (task P3.2 / next flight item) reads these variables.
Configure them in the Vercel project's **Environment Variables** panel under the license-service project:

```
# Signing key for issuing licenses (from scripts/license-keygen.mts output)
HIVEMATRIX_LICENSE_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n..."

# Lemon Squeezy webhook signing secret (from step 4 above)
LEMON_WEBHOOK_SECRET="<32-byte hex from openssl rand>"

# Lemon Squeezy API key (from step 5; optional for webhook-only operation)
LEMON_API_KEY="eyJ..."

# Known variant IDs for tier mapping (from step 3 above)
LEMON_VARIANT_MONTHLY="<variant-id-from-step-3>"
LEMON_VARIANT_ANNUAL="<variant-id-from-step-3>"

# Email delivery for license emails (Resend or SMTP)
# Resend is the recommended option — sign up at resend.com, free tier is sufficient
RESEND_API_KEY="re_..."
RESEND_FROM="HiveMatrix <licenses@hivematrix.app>"
```

**Do NOT commit these values to any repository.** They live only in Vercel's secret manager.

---

## 7. Test Mode Verification

Before going live, verify the full flow in test mode:
1. In Lemon Squeezy, enable **Test Mode** (toggle in top bar).
2. Use card `4242 4242 4242 4242`, any future expiry, any CVC.
3. Complete a checkout for each product — confirm `order_created` webhook fires.
4. Check that the license service (once deployed in P3.2) receives the webhook, signs a license, and emails it.
5. Activate the license in the HiveMatrix daemon via Settings → "Enter license key".
6. Verify that Pro gates unlock (`channel_mail`, `voice`, etc.) without restart.
7. Simulate cancellation: confirm the next renewal period's license is not issued, and the existing license degrades after its grace period.

---

## 8. Handoff Checklist

After completing the steps above, record these values (in your secure vault, not in this file):

- [ ] Lemon Squeezy store slug confirmed: `hivematrix`
- [ ] Monthly product ID + variant ID noted
- [ ] Annual product ID + variant ID noted
- [ ] Webhook URL set (or placeholder pending P3.2 deploy)
- [ ] `LEMON_WEBHOOK_SECRET` saved to Vercel env vars
- [ ] `LEMON_API_KEY` saved to Vercel env vars
- [ ] `HIVEMATRIX_LICENSE_PRIVATE_KEY_PEM` saved to Vercel env vars (from `~/.hivematrix/keys/license-ed25519-private.pem`)
- [ ] `LEMON_VARIANT_MONTHLY` + `LEMON_VARIANT_ANNUAL` saved to Vercel env vars
- [ ] Test mode checkout verified end-to-end
- [ ] Payout bank account connected (can be post-launch)

Once all boxes are checked, the next flight item (P3.2 — webhook receiver implementation) can be executed without further operator input.
