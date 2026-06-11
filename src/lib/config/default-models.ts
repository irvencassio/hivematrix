import { normalizeModelOption } from "@/lib/models/catalog";

interface DefaultModelConfigLike {
  defaultModel?: unknown;
  defaultModelByProfile?: unknown;
}

type DefaultModelMap = Record<string, string>;

function asDefaultModelMap(value: unknown): DefaultModelMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function normalizeProfileKey(profile?: string | null): string {
  const raw = String(profile ?? "").trim();
  if (!raw || raw === "default" || raw === ".claude") return ".claude";
  if (raw.startsWith(".claude-")) return raw;
  if (raw.startsWith(".")) return raw;
  return `.claude-${raw.replace(/^claude-?/, "")}`;
}

export function getDefaultModelForProfile(config: DefaultModelConfigLike, profile?: string | null): string {
  const profileKey = normalizeProfileKey(profile);
  const profileName = profileKey.replace(/^\.claude-?/, "") || "default";
  const defaultModelByProfile = asDefaultModelMap(config.defaultModelByProfile);
  const candidate = defaultModelByProfile[profileKey] ?? defaultModelByProfile[profileName] ?? config.defaultModel;
  return normalizeModelOption(candidate);
}

export function setDefaultModelForProfile(
  config: DefaultModelConfigLike,
  profile: string | null | undefined,
  model: string,
): void {
  const defaultModelByProfile = asDefaultModelMap(config.defaultModelByProfile);
  defaultModelByProfile[normalizeProfileKey(profile)] = normalizeModelOption(model);
  config.defaultModelByProfile = defaultModelByProfile;
}
