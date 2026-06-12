/**
 * Image generation (W5.1) — replaces the v1 stub.
 *
 * Per DECISIONS Q5: Nano Banana (the "nanai" cloud provider) when cloud-ok;
 * mflux (local MLX FLUX) as the local fallback in local-only / offline. The
 * backend choice is pure (resolveImageBackend); generation writes a PNG artifact
 * to the task's artifact dir.
 */

import { execFile } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { readFileSync } from "fs";
import { homedir } from "os";
import { ensureScopeDir } from "@/lib/artifacts/paths";
import { getConnectivityPolicy, type ConnectivityMode } from "@/lib/connectivity/policy";
import { NANO_BANANA_MODEL_ID } from "@/lib/models/catalog";

export type ImageBackend = "nanai" | "mflux";

/** Pure: which image backend to use for a connectivity mode. */
export function resolveImageBackend(mode: ConnectivityMode): ImageBackend {
  return mode === "cloud-ok" ? "nanai" : "mflux";
}

/** Pure: the mflux CLI command to render a prompt to a PNG. */
export function buildMfluxCommand(prompt: string, outPath: string, opts: { model?: string; steps?: number } = {}): { cmd: string; args: string[] } {
  return {
    cmd: "mflux-generate",
    args: ["--model", opts.model ?? "schnell", "--prompt", prompt, "--output", outPath, "--steps", String(opts.steps ?? 4)],
  };
}

/** The artifact path for a generated image. */
export function imageArtifactPath(taskId: string, stamp: string): string {
  return join(ensureScopeDir("task", taskId), `generated-${stamp}.png`);
}

interface NanaiConfig { endpoint: string; apiKey: string; model: string }

function readNanaiConfig(): NanaiConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const img = cfg?.image ?? {};
    const endpoint = typeof img.endpoint === "string" ? img.endpoint : "";
    const apiKey = (typeof img.apiKeyEnv === "string" ? process.env[img.apiKeyEnv] : undefined) ?? process.env.NANAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    if (!endpoint || !apiKey) return null;
    return { endpoint, apiKey, model: typeof img.model === "string" ? img.model : NANO_BANANA_MODEL_ID };
  } catch {
    return null;
  }
}

/** Cloud generation via an OpenAI-images-compatible endpoint. Writes PNG; returns ok. */
export async function generateViaNanai(prompt: string, outPath: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const cfg = readNanaiConfig();
  if (!cfg) return { ok: false, detail: "nanai (cloud image) not configured (config.image.endpoint + key)" };
  try {
    const base = cfg.endpoint.replace(/\/+$/, "");
    const url = base.endsWith("/v1") ? `${base}/images/generations` : `${base}/v1/images/generations`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, prompt, n: 1, size: "1024x1024", response_format: "b64_json" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false, detail: `image endpoint HTTP ${res.status}` };
    const data = await res.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return { ok: false, detail: "no image data returned" };
    writeFileSync(outPath, Buffer.from(b64, "base64"));
    return { ok: true, detail: outPath };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Local generation via the mflux CLI. Writes PNG; returns ok. */
export function generateViaMflux(prompt: string, outPath: string, timeoutMs = 300_000): Promise<{ ok: boolean; detail: string }> {
  const { cmd, args } = buildMfluxCommand(prompt, outPath);
  // mflux/python live under homebrew/user bin, not a launchd daemon's default PATH.
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${join(homedir(), ".local/bin")}:${process.env.PATH ?? ""}` };
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env }, (err) => {
      resolve(err ? { ok: false, detail: `mflux failed: ${err.message}` } : { ok: true, detail: outPath });
    });
  });
}

export interface GenerateResult { ok: boolean; backend: ImageBackend; path?: string; detail: string }

/**
 * Generate an image for a task. Picks the backend by connectivity mode; if the
 * cloud backend isn't configured it falls back to local mflux (honest local
 * posture). `stamp` is injected so the artifact name is deterministic in tests.
 */
export async function generateImage(taskId: string, prompt: string, stamp: string): Promise<GenerateResult> {
  const mode = getConnectivityPolicy().mode;
  const backend = resolveImageBackend(mode);
  const outPath = imageArtifactPath(taskId, stamp);

  if (backend === "nanai") {
    const r = await generateViaNanai(prompt, outPath);
    if (r.ok) return { ok: true, backend: "nanai", path: outPath, detail: r.detail };
    // cloud not configured / failed → try local fallback
    const fb = await generateViaMflux(prompt, outPath);
    return fb.ok
      ? { ok: true, backend: "mflux", path: outPath, detail: `nanai unavailable (${r.detail}); used mflux` }
      : { ok: false, backend: "nanai", detail: `nanai: ${r.detail}; mflux fallback: ${fb.detail}` };
  }

  const r = await generateViaMflux(prompt, outPath);
  return r.ok ? { ok: true, backend: "mflux", path: outPath, detail: r.detail } : { ok: false, backend: "mflux", detail: r.detail };
}
