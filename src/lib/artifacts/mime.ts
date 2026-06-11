const MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
};

export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";
}

/** iframe: renderable as HTML. image: as <img>. download: fallback. */
export function isInlineRenderable(mime: string): "iframe" | "image" | "download" {
  if (mime.startsWith("text/html")) return "iframe";
  if (mime === "image/svg+xml") return "iframe";
  if (mime.startsWith("image/")) return "image";
  return "download";
}
