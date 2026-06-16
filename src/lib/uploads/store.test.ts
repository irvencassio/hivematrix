import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveUpload, safeUploadName, uploadsDir } from "./store";

test("saveUpload writes the decoded bytes and returns an absolute path", () => {
  const dir = mkdtempSync(join(tmpdir(), "uploads-"));
  try {
    const bytes = Buffer.from("hello photo bytes");
    const saved = saveUpload({ filename: "IMG_1234.jpg", dataBase64: bytes.toString("base64") }, { baseDir: dir, id: "abc123" });
    assert.equal(saved.filename, "abc123-IMG_1234.jpg");
    assert.equal(saved.path, join(dir, "abc123-IMG_1234.jpg"));
    assert.equal(saved.bytes, bytes.length);
    assert.deepEqual(readFileSync(saved.path), bytes, "file on disk matches the uploaded bytes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveUpload rejects an empty or missing payload", () => {
  const dir = mkdtempSync(join(tmpdir(), "uploads-"));
  try {
    assert.throws(() => saveUpload({ filename: "x.png" }, { baseDir: dir }), /dataBase64 is required/);
    assert.throws(() => saveUpload({ filename: "x.png", dataBase64: "" }, { baseDir: dir }), /dataBase64 is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safeUploadName strips path traversal and untrusted extensions", () => {
  // No directory escape: only the basename survives, prefixed with the id.
  assert.equal(safeUploadName("../../etc/passwd", "id"), "id-passwd.bin");
  assert.equal(safeUploadName("/var/mobile/tmp/photo.heic", "id"), "id-photo.heic");
  // Unknown/dangerous extension is neutralized to .bin (bytes still saved).
  assert.equal(safeUploadName("run.sh", "id"), "id-run.bin");
  // Empty/odd names still produce a usable filename.
  assert.equal(safeUploadName("", "id"), "id-upload.bin");
});

test("uploadsDir lands under ~/.hivematrix/uploads", () => {
  assert.equal(uploadsDir("/home/me"), "/home/me/.hivematrix/uploads");
});
