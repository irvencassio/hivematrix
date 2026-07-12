/**
 * Flash Lane — vision image normalization.
 *
 * Images that reach a Flash turn come from two sources: an iMessage
 * attachment path (messagebee/imessage.ts) or a base64 upload from a chat
 * composer (POST /flash/turn's `imagesBase64`, decoded here). Either way, the
 * `claude` CLI subprocess spawned for the turn (loop.ts's buildFlashSpawnArgs,
 * with Read allowed for that spawn) needs a LOCAL, READABLE, common-format
 * file to point its Read tool at:
 *
 *   - Some sources (iPhone photos) are HEIC/HEIF, which the CLI's Read tool
 *     does not reliably describe — convert to JPEG via macOS's built-in
 *     `sips` (no extra dependency).
 *   - Copying into a daemon-owned temp dir also sidesteps any path/permission
 *     mismatch between where the source file lives (e.g. deep inside
 *     ~/Library/Messages/Attachments/) and what the spawned process can read.
 *
 * Best-effort throughout: a source file that's missing, unreadable, or fails
 * HEIC conversion is silently skipped — one bad image must never throw into
 * (and break) the turn. Callers should treat an empty return as "nothing to
 * show," not an error.
 */

import { execFile } from "child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir, homedir } from "os";
import { join, extname } from "path";
import { randomUUID } from "crypto";

const HEIC_EXTS = new Set([".heic", ".heif"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".webp"]);

/** True when `path`'s extension looks like a supported image format. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extname(path).toLowerCase());
}

/** Expand a leading `~` (chat.db attachment filenames use it as a literal path segment). */
export function expandHome(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

/** The daemon-owned scratch dir normalized images are copied/converted into. */
export function visionTempDir(): string {
  const dir = join(homedir(), ".hivematrix", "vision-tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Real HEIC→JPEG conversion via macOS's built-in `sips`. Resolves false on any failure. */
function sipsToJpeg(src: string, dest: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("sips", ["-s", "format", "jpeg", src, "--out", dest], (err) => resolve(!err));
  });
}

export interface NormalizeImageOptions {
  /** Destination dir for normalized copies (default: visionTempDir()). */
  tempDir?: string;
  /** Test-only: override the HEIC→JPEG conversion instead of shelling out to `sips`. */
  __convertHeic?: (src: string, dest: string) => Promise<boolean>;
}

/**
 * Copy/normalize a list of source image paths into daemon-readable files:
 * HEIC/HEIF sources are converted to JPEG; everything else is copied as-is
 * into the temp dir. Returns only the paths that succeeded — a source that's
 * missing, unreadable, or fails conversion is silently dropped so one bad
 * attachment never breaks the turn. Order is preserved for the surviving paths.
 */
export async function normalizeImagePaths(
  sourcePaths: string[],
  opts: NormalizeImageOptions = {},
): Promise<string[]> {
  if (!sourcePaths.length) return [];
  const dir = opts.tempDir ?? visionTempDir();
  const convertHeic = opts.__convertHeic ?? sipsToJpeg;
  const out: string[] = [];

  for (const raw of sourcePaths) {
    try {
      const src = expandHome(raw);
      if (!existsSync(src)) continue;
      const ext = extname(src).toLowerCase();
      const base = randomUUID();

      if (HEIC_EXTS.has(ext)) {
        const dest = join(dir, `${base}.jpg`);
        const ok = await convertHeic(src, dest);
        if (ok && existsSync(dest)) out.push(dest);
        continue;
      }

      const dest = join(dir, `${base}${ext || ".img"}`);
      copyFileSync(src, dest);
      out.push(dest);
    } catch {
      // Best-effort: skip a file that can't be normalized.
    }
  }
  return out;
}

/** `data:<mime>;base64,<data>` → file extension, for uploads that arrive as data URLs. */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/webp": ".webp",
};

const DATA_URL_RE = /^data:([^;]+);base64,([\s\S]+)$/;

/**
 * Decode one base64-encoded image (a `data:` URL, or a bare base64 string
 * treated as JPEG) into a staging file. Returns null on any decode failure —
 * never throws, so one bad upload in a batch doesn't drop the rest.
 */
export function decodeBase64Image(dataUrl: string, index: number, stagingDir: string): string | null {
  try {
    const trimmed = dataUrl.trim();
    const match = DATA_URL_RE.exec(trimmed);
    const mime = match ? match[1] : "image/jpeg";
    const b64 = match ? match[2] : trimmed;
    const ext = MIME_EXT[mime.toLowerCase()] ?? ".jpg";
    const dest = join(stagingDir, `upload-${index}-${randomUUID()}${ext}`);
    writeFileSync(dest, Buffer.from(b64, "base64"));
    return dest;
  } catch {
    return null;
  }
}

/**
 * Decode a batch of base64-encoded image uploads (POST /flash/turn's
 * `imagesBase64`, each a `data:<mime>;base64,...` string) and normalize them
 * through the same path as iMessage attachments (normalizeImagePaths) —
 * HEIC uploads get converted, everything lands in the daemon-owned vision
 * temp dir. Best-effort: a bad entry is skipped, never thrown.
 */
export async function saveBase64Images(dataUrls: string[], opts: NormalizeImageOptions = {}): Promise<string[]> {
  if (!dataUrls.length) return [];
  const staging = mkdtempSync(join(tmpdir(), "hm-vision-upload-"));
  const staged = dataUrls
    .map((d, i) => decodeBase64Image(d, i, staging))
    .filter((p): p is string => !!p);
  return normalizeImagePaths(staged, opts);
}
