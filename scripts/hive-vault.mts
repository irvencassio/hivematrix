#!/usr/bin/env tsx
import { parseVaultCli, renderVaultCliHelp } from "../src/lib/vault/cli";
import { readToken } from "../src/lib/auth/token";

const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;

async function readStdinValue(): Promise<string> {
  return await new Promise((resolve) => {
    const chunks: string[] = [];
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => chunks.push(chunk));
    process.stdin.on("end", () => {
      resolve(chunks.join("").replace(/\r?\n$/, ""));
    });
  });
}

async function main(): Promise<void> {
  const command = parseVaultCli(process.argv.slice(2));
  if (command.command === "help") {
    console.log(renderVaultCliHelp());
    return;
  }

  const token = readToken("auth-token") ?? "";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` } as const;

  if (command.command === "list") {
    const q = command.scope ? `?scope=${encodeURIComponent(command.scope)}` : "";
    const res = await fetch(`${base}/vault/refs${q}`, { headers });
    console.log(await res.text());
    process.exitCode = res.ok ? 0 : 1;
    return;
  }

  if (command.command === "set") {
    const fromStdin = command.value == null ? await readStdinValue() : command.value;
    if (!fromStdin.trim()) {
      throw new Error("vault set value is required. Pass --value or pipe a value into stdin.");
    }
    const body = {
      scope: command.scope,
      name: command.name,
      label: command.label ?? "",
      value: fromStdin,
    };
    const res = await fetch(`${base}/vault/refs`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(await res.text());
      process.exitCode = 1;
      return;
    }
    const bodyText = await res.text();
    console.log(bodyText);
    process.exitCode = 0;
    return;
  }

  if (command.command === "rm") {
    const res = await fetch(
      `${base}/vault/refs/${encodeURIComponent(command.scope)}/${encodeURIComponent(command.name)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok) {
      console.error(await res.text());
      process.exitCode = 1;
      return;
    }
    const bodyText = await res.text();
    console.log(bodyText);
    process.exitCode = 0;
    return;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
