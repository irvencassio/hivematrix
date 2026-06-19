import test from "node:test";
import assert from "node:assert/strict";

import {
  appendAttachmentBlock,
  normalizeTaskAttachments,
  prependAttachmentBlock,
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

test("normalizeTaskAttachments treats relative record paths as unavailable", () => {
  assert.deepEqual(normalizeTaskAttachments([{ filename: "photo.png", path: "photo.png" }]), [
    { filename: "photo.png" },
  ]);
  const block = renderAttachmentBlock([{ filename: "photo.png", path: "photo.png" }]);

  assert.match(block, /- photo\.png/);
  assert.match(block, /path: unavailable \(attachment was not uploaded\)/);
  assert.doesNotMatch(block, /path: photo\.png/);
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

test("appendAttachmentBlock joins text and attachment guidance with one blank line", () => {
  assert.equal(
    appendAttachmentBlock("hello", [{ filename: "a.txt", path: "/tmp/a.txt" }]),
    [
      "hello",
      "",
      "Attached files:",
      "- a.txt",
      "  path: /tmp/a.txt",
      "",
      "Use the absolute path above to read each attachment from disk. Do not search for the original filename in the working directory.",
    ].join("\n"),
  );
});

test("prependAttachmentBlock keeps paths before long reply text", () => {
  const longReply = "x".repeat(3000);
  const text = prependAttachmentBlock(longReply, [{ filename: "shot.png", path: "/tmp/shot.png" }]);

  assert.match(text.slice(0, 2000), /^Attached files:\n- shot\.png\n  path: \/tmp\/shot\.png/);
  assert.match(text.slice(0, 2000), /Use the absolute path above to read each attachment from disk/);
  assert.ok(text.endsWith(longReply));
});
