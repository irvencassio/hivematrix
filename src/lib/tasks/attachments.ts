import { basename } from "node:path";

export interface TaskAttachmentRecord {
  path?: string;
  filename?: string;
  bytes?: number;
}

export type TaskAttachmentInput = string | TaskAttachmentRecord | null | undefined;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOne(input: TaskAttachmentInput): TaskAttachmentRecord | null {
  if (!input) return null;
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return null;
    if (isAbsolutePath(value)) return { path: value, filename: basename(value) || value };
    return { filename: value };
  }

  const path = cleanString(input.path);
  const filename = cleanString(input.filename) || (path ? basename(path) : "");
  const out: TaskAttachmentRecord = {};
  if (filename) out.filename = filename;
  if (path && isAbsolutePath(path)) out.path = path;
  if (typeof input.bytes === "number" && Number.isFinite(input.bytes)) out.bytes = input.bytes;
  return out.filename || out.path ? out : null;
}

export function normalizeTaskAttachments(input: TaskAttachmentInput | TaskAttachmentInput[]): TaskAttachmentRecord[] {
  const values = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const out: TaskAttachmentRecord[] = [];
  for (const value of values) {
    const normalized = normalizeOne(value);
    if (!normalized) continue;
    const key = normalized.path ? `path:${normalized.path}` : `name:${normalized.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function renderAttachmentBlock(input: TaskAttachmentInput | TaskAttachmentInput[]): string {
  const attachments = normalizeTaskAttachments(input);
  if (!attachments.length) return "";
  const lines = ["Attached files:"];
  for (const attachment of attachments) {
    const label = attachment.filename || attachment.path || "attachment";
    lines.push(`- ${label}`);
    lines.push(
      attachment.path
        ? `  path: ${attachment.path}`
        : "  path: unavailable (attachment was not uploaded)",
    );
  }
  lines.push("");
  lines.push("Use the absolute path above to read each attachment from disk. Do not search for the original filename in the working directory.");
  return lines.join("\n");
}

export function appendAttachmentBlock(text: string, input: TaskAttachmentInput | TaskAttachmentInput[]): string {
  const block = renderAttachmentBlock(input);
  if (!block) return text;
  return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${block}`;
}

export function prependAttachmentBlock(text: string, input: TaskAttachmentInput | TaskAttachmentInput[]): string {
  const block = renderAttachmentBlock(input);
  if (!block) return text;
  return `${block}${text.trim() ? "\n\n" : ""}${text}`;
}
