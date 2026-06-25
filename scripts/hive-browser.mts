#!/usr/bin/env tsx
import { parseBrowserLaneCli, renderBrowserLaneHelp } from "../src/lib/browser-lane/cli";
import { readToken } from "../src/lib/auth/token";

const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;

async function main(): Promise<void> {
  const command = parseBrowserLaneCli(process.argv.slice(2));
  if (command.command === "help") {
    console.log(renderBrowserLaneHelp());
    return;
  }

  const token = readToken("auth-token") ?? "";
  if (command.command === "status") {
    const res = await fetch(`${base}/browser-lane/health`, { headers: { Authorization: `Bearer ${token}` } });
    console.log(await res.text());
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (command.command === "probe") {
    const res = await fetch(`${base}/browser-lane/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ siteId: command.siteId }),
    });
    console.log(await res.text());
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (command.command === "open") {
    const res = await fetch(`${base}/lane/browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ args: { mode: "open", url: command.siteIdOrUrl } }),
    });
    console.log(await res.text());
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (command.command === "auth-set") {
    console.log(JSON.stringify({
      ok: true,
      next: "Open Browser Lane maintenance UI to save/update the secret in macOS Keychain.",
      siteId: command.siteId,
      credentialRef: command.credentialRef,
      username: command.username ?? null,
    }, null, 2));
    return;
  }

  const res = await fetch(`${base}/lane/browser`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ args: command.args }),
  });
  console.log(await res.text());
  process.exitCode = res.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
