import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
  decodeBase64Image,
  expandHome,
  isImagePath,
  normalizeImagePaths,
  saveBase64Images,
} from "./images";

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

test("isImagePath recognizes common image extensions, case-insensitively", () => {
  for (const p of ["a.jpg", "a.JPEG", "a.png", "a.gif", "a.heic", "a.HEIF", "a.webp"]) {
    assert.equal(isImagePath(p), true, p);
  }
  for (const p of ["a.caf", "a.mov", "a.pdf", "a.txt", "noext"]) {
    assert.equal(isImagePath(p), false, p);
  }
});

test("expandHome expands a leading ~ against the current home dir; leaves absolute paths alone", () => {
  assert.equal(expandHome("~/Library/x.jpg"), join(homedir(), "Library", "x.jpg"));
  assert.equal(expandHome("/absolute/x.jpg"), "/absolute/x.jpg");
});

test("decodeBase64Image parses a data: URL and picks the extension from its mime type", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-vision-decode-"));
  try {
    // 1x1 transparent PNG
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const path = decodeBase64Image(`data:image/png;base64,${png1x1}`, 0, dir);
    assert.ok(path, "decode should succeed");
    assert.match(path!, /\.png$/);
    assert.ok(existsSync(path!));
    assert.ok(readFileSync(path!).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decodeBase64Image treats a bare base64 string (no data: prefix) as JPEG", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-vision-decode-bare-"));
  try {
    const path = decodeBase64Image(Buffer.from("not really a jpeg but bytes").toString("base64"), 0, dir);
    assert.ok(path);
    assert.match(path!, /\.jpg$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decodeBase64Image returns null instead of throwing on garbage input", () => {
  // A directory that doesn't exist as a staging dir forces writeFileSync to throw.
  const path = decodeBase64Image("data:image/png;base64,AAAA", 0, "/nonexistent/dir/that/does/not/exist");
  assert.equal(path, null);
});

// ------------------------------------------------------------------
// normalizeImagePaths — copy + HEIC conversion (sips mocked out)
// ------------------------------------------------------------------

test("normalizeImagePaths copies a non-HEIC source into the temp dir unchanged", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "hm-vision-src-"));
  const destDir = mkdtempSync(join(tmpdir(), "hm-vision-dest-"));
  try {
    const src = join(srcDir, "photo.jpg");
    writeFileSync(src, "fake-jpeg-bytes");

    const out = await normalizeImagePaths([src], { tempDir: destDir });
    assert.equal(out.length, 1);
    assert.match(out[0], /\.jpg$/);
    assert.ok(out[0].startsWith(destDir));
    assert.equal(readFileSync(out[0], "utf8"), "fake-jpeg-bytes");
  } finally {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  }
});

test("normalizeImagePaths converts a HEIC source via the injected converter (sips mocked)", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "hm-vision-heic-src-"));
  const destDir = mkdtempSync(join(tmpdir(), "hm-vision-heic-dest-"));
  try {
    const src = join(srcDir, "photo.heic");
    writeFileSync(src, "fake-heic-bytes");

    let converterCalledWith: [string, string] | null = null;
    const out = await normalizeImagePaths([src], {
      tempDir: destDir,
      __convertHeic: async (from, to) => {
        converterCalledWith = [from, to];
        writeFileSync(to, "fake-converted-jpeg");
        return true;
      },
    });

    assert.equal(out.length, 1);
    assert.match(out[0], /\.jpg$/, "HEIC is converted to .jpg, never left as .heic");
    assert.ok(converterCalledWith, "the injected converter was invoked");
    assert.equal(converterCalledWith![0], src);
    assert.equal(readFileSync(out[0], "utf8"), "fake-converted-jpeg");
  } finally {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  }
});

test("normalizeImagePaths is best-effort: a missing source or a failed HEIC conversion is skipped, never thrown", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "hm-vision-mixed-src-"));
  const destDir = mkdtempSync(join(tmpdir(), "hm-vision-mixed-dest-"));
  try {
    const goodSrc = join(srcDir, "good.jpg");
    writeFileSync(goodSrc, "good-bytes");
    const missingSrc = join(srcDir, "does-not-exist.jpg");
    const badHeicSrc = join(srcDir, "corrupt.heic");
    writeFileSync(badHeicSrc, "corrupt-bytes");

    const out = await normalizeImagePaths([goodSrc, missingSrc, badHeicSrc], {
      tempDir: destDir,
      __convertHeic: async () => false, // simulate sips failing
    });

    assert.equal(out.length, 1, "only the good source survives");
    assert.equal(readFileSync(out[0], "utf8"), "good-bytes");
  } finally {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  }
});

test("normalizeImagePaths on an empty list returns an empty list without touching the filesystem", async () => {
  assert.deepEqual(await normalizeImagePaths([]), []);
});

// ------------------------------------------------------------------
// saveBase64Images — decode + normalize end to end
// ------------------------------------------------------------------

test("saveBase64Images decodes a batch of data URLs and normalizes them into the temp dir", async () => {
  const destDir = mkdtempSync(join(tmpdir(), "hm-vision-b64-dest-"));
  try {
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const out = await saveBase64Images([`data:image/png;base64,${png1x1}`], { tempDir: destDir });
    assert.equal(out.length, 1);
    assert.match(out[0], /\.png$/);
    assert.ok(out[0].startsWith(destDir));
  } finally {
    rmSync(destDir, { recursive: true, force: true });
  }
});

test("saveBase64Images on an empty list returns an empty list", async () => {
  assert.deepEqual(await saveBase64Images([]), []);
});
