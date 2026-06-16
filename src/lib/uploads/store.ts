/**
 * Inbound file uploads. Remote clients (notably the iOS app) hold attachments at
 * paths that are meaningless on THIS machine — a photo lives at
 * /var/mobile/.../tmp/x.jpg on the phone, which the Mac daemon and the agent
 * cannot read. So the client must ship the BYTES; this module persists them under
 * ~/.hivematrix/uploads and returns an absolute local path the agent can open.
 */

import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, extname, basename } from "path";
import { randomBytes } from "crypto";

// Extensions we keep as-is; anything else is stored as .bin (the bytes are still
// written — we just don't trust an arbitrary client-supplied extension).
const SAFE_EXT = new Set([
  "jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "tiff", "bmp",
  "mov", "mp4", "m4v", "pdf", "txt", "md", "csv", "json",
]);

export function uploadsDir(base: string = homedir()): string {
  return join(base, ".hivematrix", "uploads");
}

/** Derive a safe, collision-free on-disk filename from a client-supplied name. */
export function safeUploadName(filename: string, id: string): string {
  const cleaned = basename(filename || "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  const ext = extname(cleaned).slice(1).toLowerCase();
  const safeExt = SAFE_EXT.has(ext) ? ext : "bin";
  const stem = (cleaned.slice(0, cleaned.length - extname(cleaned).length).slice(0, 60)) || "upload";
  return `${id}-${stem}.${safeExt}`;
}

export interface SavedUpload {
  path: string;
  filename: string;
  bytes: number;
}

/**
 * Decode a base64 payload and write it under the uploads dir. Returns the
 * absolute path the agent can read. Throws on a missing/empty payload.
 */
export function saveUpload(
  input: { filename?: string; dataBase64?: string },
  opts: { baseDir?: string; id?: string } = {},
): SavedUpload {
  const data = typeof input.dataBase64 === "string" ? input.dataBase64.trim() : "";
  if (!data) throw new Error("dataBase64 is required");
  const buf = Buffer.from(data, "base64");
  if (buf.length === 0) throw new Error("upload is empty (invalid base64?)");

  const id = opts.id ?? randomBytes(8).toString("hex");
  const dir = opts.baseDir ?? uploadsDir();
  mkdirSync(dir, { recursive: true });
  const filename = safeUploadName(input.filename ?? "upload", id);
  const path = join(dir, filename);
  writeFileSync(path, buf);
  return { path, filename, bytes: buf.length };
}
