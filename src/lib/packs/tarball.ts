/**
 * Minimal in-memory POSIX TAR parser — no external dependencies.
 * Used by parseHmpack to read .hmpack (gzipped TAR) files.
 */

import { gunzipSync } from "node:zlib";

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = buf.subarray(offset, offset + length).toString("ascii").replace(/\0/g, "").trim();
  return s ? parseInt(s, 8) : 0;
}

function readString(buf: Buffer, offset: number, length: number): string {
  return buf.subarray(offset, offset + length).toString("utf8").replace(/\0+$/g, "");
}

/**
 * Parse an uncompressed TAR buffer into a map of path → file content.
 * Handles POSIX ustar headers (prefix field for long paths).
 * Directories and non-regular entries are skipped.
 */
export function parseTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);

    // Two consecutive zero-filled blocks = end-of-archive marker
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = header[156]; // 0x30 = '0' = regular file; 0x00 = old-style regular

    // UStar prefix for long filenames (magic = "ustar")
    const magic = readString(header, 257, 6);
    let fullName = name;
    if (magic.startsWith("ustar")) {
      const prefix = readString(header, 345, 155);
      if (prefix) fullName = `${prefix}/${name}`;
    }

    offset += 512; // advance past header

    if (typeFlag === 0x30 || typeFlag === 0x00) {
      files.set(fullName, Buffer.from(tar.subarray(offset, offset + size)));
    }

    // Advance past data block(s), padded to 512-byte boundary
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

/** Decompress a gzipped TAR buffer and return its file entries. */
export function parseTarGz(buffer: Buffer): Map<string, Buffer> {
  return parseTar(gunzipSync(buffer));
}
