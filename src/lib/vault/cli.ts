import { ContractValidationError } from "@/lib/central/contracts";

export type VaultCliCommand =
  | { command: "help" }
  | { command: "list"; scope?: string }
  | { command: "set"; scope: string; name: string; label?: string; value?: string }
  | { command: "rm"; scope: string; name: string };

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function readFlag(argv: string[], flag: string): string | undefined {
  const exact = argv.indexOf(flag);
  if (exact >= 0) return argv[exact + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  return undefined;
}

function requireValue(value: string | undefined, label: string): string {
  const next = value?.trim();
  if (!next) fail(`${label} is required`);
  return next;
}

export function parseVaultCli(argv: string[]): VaultCliCommand {
  const [command, ...rest] = argv;

  if (!command || command === "" || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "list") {
    return {
      command: "list",
      scope: readFlag(rest, "--scope") ?? undefined,
    };
  }

  if (command === "set") {
    const scope = requireValue(readFlag(rest, "--scope"), "scope");
    const name = requireValue(readFlag(rest, "--name"), "name");
    const value = readFlag(rest, "--value");
    const label = readFlag(rest, "--label");
    return {
      command: "set",
      scope,
      name,
      label: label || "",
      value,
    };
  }

  if (command === "rm") {
    const hasFlagArgs = rest.some((arg) => arg === "--scope" || arg === "--name" || arg.startsWith("--scope=") || arg.startsWith("--name="));
    const scope = requireValue(readFlag(rest, "--scope") ?? (!hasFlagArgs ? rest[0] : undefined), "scope");
    const name = requireValue(readFlag(rest, "--name") ?? (!hasFlagArgs ? rest[1] : undefined), "name");
    return {
      command: "rm",
      scope,
      name,
    };
  }

  fail(`unknown vault command: ${command}`);
}

export function renderVaultCliHelp(): string {
  return [
    "HiveMatrix Vault",
    "",
    "Commands:",
    "  hive vault list [--scope <scope>]",
    "  hive vault set --scope <scope> --name <name> [--label <label>] [--value <value>]",
    "  hive vault rm --scope <scope> --name <name>",
    "",
    "Never pass secret values directly in normal shell scripts unless you're prepared for command history and process list exposure.",
    "For automated scripts, pipe the value into stdin:",
    "  printf \"my-value\" | hive vault set --scope site --name github.com",
  ].join("\n");
}
