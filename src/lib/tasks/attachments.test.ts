import test from "node:test";
import assert from "node:assert/strict";

import {
  appendAttachmentBlock,
  normalizeTaskAttachments,
  renderAttachmentBlock,
} from "./attachments";

test("renderAttachmentBlock shows original filename, absolute path, and disk guidance", () => {
  const block = renderAttachmentBlock([
    {
      filename: "Screenshot 2026-06-19 at 9.08.33 AM.png",
      path: "/Users/irvcassio/.hivematrix/uploads/abc-Screenshot.png",
      bytes: 123,
    },
  ]);

  assert.match(block, /^Attached files:/);
  assert.match(block, /Screenshot 2026-06-19 at 9\.08\.33 AM\.png/);
  assert.match(block, /path: \/Users\/irvcassio\/\.hivematrix\/uploads\/abc-Screenshot\.png/);
  assert.match(block, /Use the absolute path above to read each attachment from disk/);
  assert.match(block, /Do not search for the original filename/);
});

test("normalizeTaskAttachments accepts absolute string paths", () => {
  assert.deepEqual(normalizeTaskAttachments(["/tmp/a.txt"]), [
    { path: "/tmp/a.txt", filename: "a.txt" },
  ]);
});

test("normalizeTaskAttachments keeps filename-only legacy values but marks path unavailable", () => {
  const block = renderAttachmentBlock(["photo.png"]);

  assert.match(block, /- photo\.png/);
  assert.match(block, /path: unavailable \(attachment was not uploaded\)/);
});

test("normalizeTaskAttachments de-duplicates repeated paths", () => {
  assert.deepEqual(
    normalizeTaskAttachments([
      "/tmp/a.txt",
      { filename: "A again", path: "/tmp/a.txt" },
      { filename: "b.txt", path: "/tmp/b.txt" },
    ]),
    [
      { path: "/tmp/a.txt", filename: "a.txt" },
      { filename: "b.txt", path: "/tmp/b.txt" },
    ],
  );
});

test("appendAttachmentBlock leaves text unchanged when there are no attachments", () => {
  assert.equal(appendAttachmentBlock("hello", []), "hello");
});
