import { ContractValidationError } from "@/lib/central/contracts";

export type BrowserLaneCliCommand =
  | { command: "help" }
  | { command: "status" }
  | { command: "probe"; siteId: string }
  | { command: "open"; siteIdOrUrl: string }
  | { command: "auth-set"; siteId: string; credentialRef: string; username?: string }
  | { command: "tool"; tool: "hivematrix_browser"; args: Record<string, unknown> };

const SECRET_FLAGS = new Set(["--password", "--pass", "--secret", "--token", "--cookie", "--totp"]);

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function rejectInlineSecrets(argv: string[]): void {
  for (const arg of argv) {
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (SECRET_FLAGS.has(key)) fail("Browser Lane CLI must not accept inline secrets; save credentials through macOS Keychain");
  }
}

function readFlag(argv: string[], flag: string): string | undefined {
  const exact = argv.indexOf(flag);
  if (exact >= 0) return argv[exact + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  return undefined;
}

function requireValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) fail(`${label} is required`);
  return trimmed;
}

export function parseBrowserLaneCli(argv: string[]): BrowserLaneCliCommand {
  rejectInlineSecrets(argv);
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "":
    case "help":
    case "--help":
    case "-h":
      return { command: "help" };
    case "status":
      return { command: "status" };
    case "probe":
      return { command: "probe", siteId: rest[0]?.trim() || "all" };
    case "open":
      return { command: "open", siteIdOrUrl: requireValue(rest[0], "site or URL") };
    case "search":
      return {
        command: "tool",
        tool: "hivematrix_browser",
        args: { mode: "search", query: requireValue(rest.join(" "), "query") },
      };
    case "read":
      return {
        command: "tool",
        tool: "hivematrix_browser",
        args: { mode: "read", url: requireValue(rest[0], "url"), query: rest.slice(1).join(" ").trim() || undefined },
      };
    case "run":
      return {
        command: "tool",
        tool: "hivematrix_browser",
        args: {
          mode: "workflow",
          startUrl: requireValue(rest[0], "start URL"),
          objective: requireValue(rest.slice(1).join(" "), "objective"),
          requiresLogin: true,
        },
      };
    case "auth": {
      if (rest[0] !== "set") fail("auth command must be: hive browser auth set <siteId> --credential-ref <ref>");
      const siteId = requireValue(rest[1], "site id");
      const credentialRef = requireValue(readFlag(rest, "--credential-ref"), "credential ref");
      if (!credentialRef.startsWith("hivematrix.browser.")) fail("credential ref must start with hivematrix.browser.");
      return { command: "auth-set", siteId, credentialRef, username: readFlag(rest, "--username") };
    }
    default:
      fail(`unknown browser command: ${command}`);
  }
}

export function renderBrowserLaneHelp(): string {
  return [
    "HiveMatrix Browser Lane",
    "",
    "Commands:",
    "  hive browser status",
    "  hive browser probe [site-id|all]",
    "  hive browser open <site-id|url>",
    "  hive browser search <query>",
    "  hive browser read <url> [question]",
    "  hive browser run <start-url> <objective>",
    "  hive browser auth set <site-id> --credential-ref hivematrix.browser.<site>.<account> [--username email]",
    "",
    "Secrets are saved through macOS Keychain/UI flows only; never pass passwords, cookies, tokens, or TOTP codes on the command line.",
  ].join("\n");
}
