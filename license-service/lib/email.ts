import type { SignedLicense } from "./types";

export async function sendLicenseEmail(
  to: string,
  name: string,
  signed: SignedLicense,
  plan: "monthly" | "annual",
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "HiveMatrix <licenses@hivematrix.app>";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const licenseJson = JSON.stringify(signed, null, 2);
  const greeting = name ? `Hi ${name.split(" ")[0]}` : "Hi";
  const expiryDate = signed.payload.expiresAt.split("T")[0];

  const html = `
<p>${greeting},</p>
<p>Thanks for subscribing to <strong>HiveMatrix Pro</strong> (${plan}). Your signed license is attached and also pasted below.</p>
<h3>To activate:</h3>
<ol>
  <li>Open HiveMatrix → <strong>Settings → License</strong> and paste the JSON</li>
  <li>Or drop <code>hivematrix-license.json</code> into <code>~/.hivematrix/license.json</code> for offline activation</li>
</ol>
<pre style="background:#f5f5f5;padding:16px;border-radius:6px;font-size:11px;overflow:auto">${licenseJson}</pre>
<p>Valid until <strong>${expiryDate}</strong> with a ${signed.payload.graceDays}-day grace period after renewal.</p>
<p>Need this resent? POST <code>{"email":"${to}"}</code> to <code>/api/license/resend-email</code> or reply here.</p>
<p>— HiveMatrix</p>`.trim();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your HiveMatrix Pro License",
      html,
      attachments: [
        {
          filename: "hivematrix-license.json",
          content: Buffer.from(licenseJson, "utf8").toString("base64"),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}
