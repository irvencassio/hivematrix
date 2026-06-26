export interface AutoUpdateProofInput {
  headCommit: string;
  packageVersion: string;
  tauriVersion: string;
  sourceVersion: string;
  buildNumber: number | null;
  tagName: string;
  tagCommit: string | null;
  releaseExists: boolean;
  feedVersion: string | null;
  feedSourceCommit: string | null;
  feedBuildNumber: number | null;
}

export interface AutoUpdateProofCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface AutoUpdateProof {
  ok: boolean;
  checks: AutoUpdateProofCheck[];
}

function sameCommit(a: string | null, b: string): boolean {
  return !!a && (a === b || a.startsWith(b) || b.startsWith(a));
}

export function evaluateAutoUpdateProof(input: AutoUpdateProofInput): AutoUpdateProof {
  const versions = [input.packageVersion, input.tauriVersion, input.sourceVersion];
  const version = input.tauriVersion;
  const checks: AutoUpdateProofCheck[] = [
    {
      id: "versions-agree",
      ok: versions.every((v) => v === version),
      detail: `package=${input.packageVersion} tauri=${input.tauriVersion} source=${input.sourceVersion}`,
    },
    {
      id: "build-number-present",
      ok: Number.isInteger(input.buildNumber) && (input.buildNumber ?? 0) > 0,
      detail: `buildNumber=${input.buildNumber ?? "missing"}`,
    },
    {
      id: "feed-build-number",
      ok: Number.isInteger(input.feedBuildNumber) && input.feedBuildNumber === input.buildNumber,
      detail: `feed=${input.feedBuildNumber ?? "missing"} source=${input.buildNumber ?? "missing"}`,
    },
    {
      id: "tag-exists",
      ok: !!input.tagCommit,
      detail: input.tagCommit ? `${input.tagName}=${input.tagCommit}` : `${input.tagName} is missing`,
    },
    {
      id: "tag-points-at-head",
      ok: sameCommit(input.tagCommit, input.headCommit),
      detail: `head=${input.headCommit} tag=${input.tagCommit ?? "missing"}`,
    },
    {
      id: "release-exists",
      ok: input.releaseExists,
      detail: `${input.tagName} release ${input.releaseExists ? "exists" : "is missing"}`,
    },
    {
      id: "feed-version",
      ok: input.feedVersion === version,
      detail: `feed=${input.feedVersion ?? "missing"} expected=${version}`,
    },
    {
      id: "feed-source-commit",
      ok: sameCommit(input.feedSourceCommit, input.headCommit),
      detail: `feed=${input.feedSourceCommit ?? "missing"} head=${input.headCommit}`,
    },
  ];

  return { ok: checks.every((c) => c.ok), checks };
}
