import { ContractValidationError } from "@/lib/central/contracts";

export type BrowserLaneCliCommand =
  | { command: "help" }
  | { command: "status" }
  | { command: "probe"; siteId: string }
  | { command: "open"; siteIdOrUrl: string }
  | { command: "sites-list" }
  | { command: "sites-add"; site: Record<string, unknown> }
  | { command: "probes-add"; probe: Record<string, unknown> }
  | { command: "trace-list" }
  | { command: "trace-latest" }
  | { command: "trace-show"; traceRunId: string }
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

function readFlags(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag && argv[i + 1]) values.push(argv[i + 1]);
    if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values.map((value) => value.trim()).filter(Boolean);
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
    case "sites": {
      const subcommand = rest[0];
      if (subcommand === "list") return { command: "sites-list" };
      if (subcommand !== "add") fail("sites command must be: hive browser sites list|add");
      const siteId = requireValue(rest[1], "site id");
      const credentialRef = readFlag(rest, "--credential-ref");
      if (credentialRef && !credentialRef.startsWith("hivematrix.browser.")) fail("credential ref must start with hivematrix.browser.");
      return {
        command: "sites-add",
        site: {
          id: siteId,
          displayName: requireValue(readFlag(rest, "--name"), "site name"),
          homeUrl: requireValue(readFlag(rest, "--home-url"), "home URL"),
          loginUrl: readFlag(rest, "--login-url") ?? null,
          allowedDomains: readFlags(rest, "--domain"),
          credentialRef: credentialRef ?? null,
        },
      };
    }
    case "probes": {
      if (rest[0] !== "add") fail("probes command must be: hive browser probes add <site-id> <probe-id>");
      const siteId = requireValue(rest[1], "site id");
      const probeId = requireValue(rest[2], "probe id");
      return {
        command: "probes-add",
        probe: {
          id: probeId,
          siteId,
          name: requireValue(readFlag(rest, "--name"), "probe name"),
          url: requireValue(readFlag(rest, "--url"), "probe URL"),
          assertions: [{ kind: "text", value: requireValue(readFlag(rest, "--text"), "expected text"), optional: false }],
          requiresAuth: true,
        },
      };
    }
    case "trace": {
      const subcommand = rest[0];
      if (subcommand === "list") return { command: "trace-list" };
      if (subcommand === "latest") return { command: "trace-latest" };
      if (subcommand === "show") return { command: "trace-show", traceRunId: requireValue(rest[1], "trace run id") };
      return fail("trace command must be: hive browser trace list|latest|show");
    }
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
    "  hive browser sites list",
    "  hive browser sites add <site-id> --name <name> --home-url <url> [--login-url <url>] [--domain domain] [--credential-ref ref]",
    "  hive browser probes add <site-id> <probe-id> --name <name> --url <url> --text <expected-text>",
    "  hive browser trace list",
    "  hive browser trace latest",
    "  hive browser trace show <trace-run-id>",
    "  hive browser open <site-id|url>",
    "  hive browser search <query>",
    "  hive browser read <url> [question]",
    "  hive browser run <start-url> <objective>",
    "  hive browser auth set <site-id> --credential-ref hivematrix.browser.<site>.<account> [--username email]",
    "",
    "Secrets are saved through macOS Keychain/UI flows only; never pass passwords, cookies, tokens, or TOTP codes on the command line.",
  ].join("\n");
}
