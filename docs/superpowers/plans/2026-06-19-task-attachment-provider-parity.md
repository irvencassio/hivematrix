# Task Attachment Provider Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure task attachments are copied to stable Mac-local paths and explained identically to Claude, ChatGPT/Codex, and Qwen/local.

**Architecture:** Add a small shared attachment formatter in `src/lib/tasks`, use the existing `/uploads` endpoint as the canonical storage path, and route all console-created new-task/retry/reply attachment instructions through the same block format. Provider runners remain unchanged because they already consume the task description as their prompt/user content.

**Tech Stack:** TypeScript, raw console HTML/JS in `src/daemon/console.ts`, Node test runner, existing SQLite task store and `/uploads` API.

## Global Constraints

- Copy every console-selected task attachment into `~/.hivematrix/uploads` before task submission references it.
- Preserve the original filename for readability and include the copied absolute path for agent access.
- The provider-facing copy must explicitly tell agents to read the files from disk using the listed absolute paths.
- Do not add provider-specific attachment APIs or branches.
- Retry and reply endpoints must accept structured attachment records and legacy string paths.
- No production code without a failing test first.
- Required verification before completion: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and `npx tsx scripts/qwen-readiness.mts`.
- After the implementation commit, run the repository release/autoupdate path so installed users receive the update.

---

## File Structure

- Create `src/lib/tasks/attachments.ts`: normalizes attachment strings/records, renders provider-facing attachment blocks, and appends blocks to text.
- Create `src/lib/tasks/attachments.test.ts`: unit tests for normalization, formatting, de-duplication, and disk-reading guidance.
- Modify `src/lib/tasks/reply-continuation.ts`: optionally appends formatted attachments to continuation replies.
- Modify `src/lib/tasks/reply-continuation.test.ts`: covers structured attachments in continuation text.
- Modify `src/daemon/server.ts`: retry/reply routes parse `body.attachments` and use the shared formatter.
- Modify `src/daemon/console.ts`: upload selected files through `/uploads`, store attachment records, render chips from stable paths, and format new-task/retry/reply attachment blocks.
- Modify `src/daemon/console.test.ts`: raw script tests for upload flow and formatting.
- Modify `src/lib/orchestrator/subprocess.test.ts`: Claude prompt arg includes formatted attachment block.
- Modify `src/lib/orchestrator/codex-agent.test.ts`: Codex prompt includes formatted attachment block after its routing preamble.
- Modify `src/lib/orchestrator/generic-agent.ts`: export `buildMessages` for test-only prompt parity.
- Modify `src/lib/orchestrator/generic-agent.test.ts`: Qwen/local messages include the same attachment block as user content.

---

### Task 1: Shared Attachment Formatter And Provider Prompt Tests

**Files:**
- Create: `src/lib/tasks/attachments.ts`
- Create: `src/lib/tasks/attachments.test.ts`
- Modify: `src/lib/orchestrator/subprocess.test.ts`
- Modify: `src/lib/orchestrator/codex-agent.test.ts`
- Modify: `src/lib/orchestrator/generic-agent.ts`
- Modify: `src/lib/orchestrator/generic-agent.test.ts`

**Interfaces:**
- Produces: `TaskAttachmentRecord`, `normalizeTaskAttachments(input)`, `renderAttachmentBlock(input)`, `appendAttachmentBlock(text, input)`.
- Produces: exported `buildMessages(description, projectPath, agentType, thinkingMode?)` from `src/lib/orchestrator/generic-agent.ts`.
- Consumes: existing `buildClaudeSpawnArgs()` and `buildCodexPrompt()`.

- [ ] **Step 1: Write failing formatter tests**

Add `src/lib/tasks/attachments.test.ts`:

```ts
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
```

- [ ] **Step 2: Run formatter tests to verify RED**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/attachments.test.ts
```

Expected: FAIL because `src/lib/tasks/attachments.ts` does not exist.

- [ ] **Step 3: Implement the shared formatter**

Create `src/lib/tasks/attachments.ts`:

```ts
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
  if (path) out.path = path;
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
```

- [ ] **Step 4: Run formatter tests to verify GREEN**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/attachments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing provider parity tests**

Append to `src/lib/orchestrator/subprocess.test.ts`:

```ts
import { renderAttachmentBlock } from "@/lib/tasks/attachments";

test("Claude prompt args preserve formatted attachment paths", () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const prompt = `Please inspect this image.\n\n${attachmentBlock}`;
  const args = buildClaudeSpawnArgs({ prompt, tools: ["Read"], thinkingMode: "auto" });

  const promptIndex = args.indexOf("-p");
  assert.notEqual(promptIndex, -1);
  assert.match(args[promptIndex + 1], /path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(args[promptIndex + 1], /Use the absolute path above/);
});
```

Append to `src/lib/orchestrator/codex-agent.test.ts`:

```ts
import { renderAttachmentBlock } from "@/lib/tasks/attachments";

test("buildCodexPrompt keeps formatted attachment paths in the task section", () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const prompt = buildCodexPrompt(`Please inspect this image.\n\n${attachmentBlock}`);

  assert.match(prompt, /--- Your task ---[\s\S]*path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.ok(prompt.indexOf("--- Your task ---") < prompt.indexOf("id-shot.png"));
});
```

Modify `src/lib/orchestrator/generic-agent.test.ts` imports:

```ts
import { buildChatCompletionsUrls, buildGenericRequestBody, buildMessages, genericThinkingInstruction } from "./generic-agent";
import { renderAttachmentBlock } from "@/lib/tasks/attachments";
```

Append:

```ts
test("generic/local messages keep formatted attachment paths as user content", async () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const messages = await buildMessages(`Please inspect this image.\n\n${attachmentBlock}`, "/tmp", "developer", "low");

  assert.equal(messages[1]?.role, "user");
  assert.match(String(messages[1]?.content), /path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(String(messages[1]?.content), /Use the absolute path above/);
});
```

- [ ] **Step 6: Run provider parity tests to verify RED**

Run:

```bash
node --import tsx/esm --test src/lib/orchestrator/subprocess.test.ts src/lib/orchestrator/codex-agent.test.ts src/lib/orchestrator/generic-agent.test.ts
```

Expected: FAIL because `buildMessages` is not exported.

- [ ] **Step 7: Export `buildMessages`**

In `src/lib/orchestrator/generic-agent.ts`, change:

```ts
async function buildMessages(
```

to:

```ts
export async function buildMessages(
```

- [ ] **Step 8: Run focused tests to verify GREEN**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/attachments.test.ts src/lib/orchestrator/subprocess.test.ts src/lib/orchestrator/codex-agent.test.ts src/lib/orchestrator/generic-agent.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/tasks/attachments.ts src/lib/tasks/attachments.test.ts src/lib/orchestrator/subprocess.test.ts src/lib/orchestrator/codex-agent.test.ts src/lib/orchestrator/generic-agent.ts src/lib/orchestrator/generic-agent.test.ts
git commit -m "feat(tasks): format attachment paths for all providers"
```

---

### Task 2: Server Retry And Reply Attachment Formatting

**Files:**
- Modify: `src/lib/tasks/reply-continuation.ts`
- Modify: `src/lib/tasks/reply-continuation.test.ts`
- Modify: `src/daemon/server.ts`

**Interfaces:**
- Consumes: `TaskAttachmentInput[]`, `appendAttachmentBlock()`, `normalizeTaskAttachments()`, `renderAttachmentBlock()` from Task 1.
- Produces: `appendReplyContinuation(description, reply, attachments?)`.
- Server routes accept `body.attachments` as either strings or `{ filename, path, bytes }` records.

- [ ] **Step 1: Write failing reply-continuation test**

Append to `src/lib/tasks/reply-continuation.test.ts`:

```ts
test("appendReplyContinuation formats structured attachments with stable paths", () => {
  const next = appendReplyContinuation("Original task", "See the screenshot.", [
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);

  assert.match(next, /--- Operator reply \(continue\) ---/);
  assert.match(next, /See the screenshot\./);
  assert.match(next, /- shot\.png\n  path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(next, /Use the absolute path above/);
});
```

- [ ] **Step 2: Run reply-continuation test to verify RED**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/reply-continuation.test.ts
```

Expected: FAIL because `appendReplyContinuation` accepts only two arguments.

- [ ] **Step 3: Implement attachment-aware continuation**

Replace `src/lib/tasks/reply-continuation.ts` with:

```ts
import { appendAttachmentBlock, type TaskAttachmentInput } from "./attachments";

export function appendReplyContinuation(
  description: string,
  reply: string,
  attachments: TaskAttachmentInput[] = [],
): string {
  return [
    description.trimEnd(),
    "",
    "--- Operator reply (continue) ---",
    appendAttachmentBlock(reply.trim(), attachments),
  ].join("\n");
}
```

- [ ] **Step 4: Run reply-continuation test to verify GREEN**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/reply-continuation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing server static tests**

Append to `src/daemon/console.test.ts` or create a focused static test in `src/daemon/server.test.ts` if one already exists. Use this raw source assertion in the chosen daemon test file:

```ts
import { readFileSync } from "node:fs";

test("server retry/reply routes format structured attachments server-side", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /@\/lib\/tasks\/attachments/);
  assert.match(server, /normalizeTaskAttachments/);
  assert.match(server, /appendAttachmentBlock/);
  assert.match(server, /appendReplyContinuation\(String\(cur\.description \?\? ""\), text, attachments\)/);
  assert.match(server, /renderAttachmentBlock\(attachments\)/);
});
```

- [ ] **Step 6: Run daemon/server test to verify RED**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: FAIL because `server.ts` does not yet import/use the formatter.

- [ ] **Step 7: Update reply route in `src/daemon/server.ts`**

Inside `POST /tasks/:id/reply`, after `const text = ...`, add:

```ts
const { normalizeTaskAttachments } = await import("@/lib/tasks/attachments");
const attachments = normalizeTaskAttachments(Array.isArray(body.attachments) ? body.attachments as unknown[] : []);
```

Change the fallback update to:

```ts
description: appendReplyContinuation(String(cur.description ?? ""), text, attachments),
```

Change the stuck resolution call to pass a formatted reply:

```ts
const { appendAttachmentBlock } = await import("@/lib/tasks/attachments");
const resolvedText = appendAttachmentBlock(text, attachments);
const ok = await resolveStuck(tid, req2.timestamp, "reply", "console", resolvedText);
```

- [ ] **Step 8: Update retry route in `src/daemon/server.ts`**

Inside the retry route, replace legacy string-only attachment parsing with:

```ts
const { normalizeTaskAttachments, renderAttachmentBlock } = await import("@/lib/tasks/attachments");
const attachments = normalizeTaskAttachments(Array.isArray(body.attachments) ? body.attachments as unknown[] : []);
```

Replace:

```ts
if (attachments.length) block += "\nAttached files:\n" + attachments.map((p) => "- " + p).join("\n");
```

with:

```ts
if (attachments.length) block += "\n" + renderAttachmentBlock(attachments);
```

- [ ] **Step 9: Run focused tests to verify GREEN**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/reply-continuation.test.ts src/daemon/console.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/lib/tasks/reply-continuation.ts src/lib/tasks/reply-continuation.test.ts src/daemon/server.ts src/daemon/console.test.ts
git commit -m "fix(tasks): preserve attachments in replies and retries"
```

---

### Task 3: Console Uploads And New Task Attachment Blocks

**Files:**
- Modify: `src/daemon/console.ts`
- Modify: `src/daemon/console.test.ts`

**Interfaces:**
- Consumes: `POST /uploads` response `{ path, filename, bytes }`.
- Produces browser-side attachment records `{ path, filename, bytes }`.
- Produces browser-side `attachmentBlock(items)` matching the server formatter copy.

- [ ] **Step 1: Write failing console script tests**

Append to `src/daemon/console.test.ts`:

```ts
test("console task attachments upload bytes before task creation", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /async function uploadTaskAttachmentFile\(/);
  assert.match(js, /readFileAsDataUrl/);
  assert.match(js, /api\("\/uploads"/);
  assert.match(js, /dataBase64/);
  assert.doesNotMatch(js, /const p = f\.path \|\| f\.name; if \(p && !_attachPaths\.includes\(p\)\) _attachPaths\.push\(p\);/);
});

test("console formats uploaded attachment records with absolute disk paths", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /function attachmentBlock\(/);
  assert.match(js, /Use the absolute path above to read each attachment from disk/);
  assert.match(js, /path: "\+a\.path/);
  assert.match(js, /_attachments/);
  assert.match(js, /_ctxAttach = \{ retry: \[\], reply: \[\] \}/);
});

test("console blocks submit while attachment uploads are pending", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /function hasPendingAttachmentUploads\(/);
  assert.match(js, /Attachment upload is still in progress/);
  assert.match(js, /setAttachmentSubmitDisabled\(/);
});
```

- [ ] **Step 2: Run console tests to verify RED**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: FAIL because the console still stores `_attachPaths` from `File.path || File.name`.

- [ ] **Step 3: Replace new-task attachment state**

In `src/daemon/console.ts`, replace:

```js
let _attachPaths = [];
```

with:

```js
let _attachments = [];
let _attachUploading = 0;
let _attachError = "";
```

Add browser helpers near the existing attachment functions:

```js
function attachmentName(a) {
  return a && (a.filename || (a.path || "").split("/").pop() || a.path) || "attachment";
}
function attachmentBlock(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";
  const lines = ["Attached files:"];
  for (const a of list) {
    lines.push("- " + attachmentName(a));
    lines.push(a.path ? "  path: " + a.path : "  path: unavailable (attachment was not uploaded)");
  }
  lines.push("");
  lines.push("Use the absolute path above to read each attachment from disk. Do not search for the original filename in the working directory.");
  return lines.join("\n");
}
function appendAttachmentBlockText(text, items) {
  const block = attachmentBlock(items);
  if (!block) return text;
  return text.trimEnd() + (text.trim() ? "\n\n" : "") + block;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(String(e.target?.result || ""));
    reader.onerror = () => reject(new Error("Failed to read " + file.name));
    reader.readAsDataURL(file);
  });
}
async function uploadTaskAttachmentFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const dataBase64 = dataUrl.split(",")[1] || "";
  const saved = await api("/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, dataBase64 }),
  });
  if (!saved || !saved.path) throw new Error(saved?.error || "Upload failed");
  return { path: saved.path, filename: file.name, bytes: saved.bytes };
}
function hasPendingAttachmentUploads() {
  return _attachUploading > 0 || _ctxUploading.retry > 0 || _ctxUploading.reply > 0;
}
function setAttachmentSubmitDisabled(disabled) {
  document.querySelectorAll(".create,.reply-primary").forEach(btn => { btn.disabled = disabled; });
}
```

- [ ] **Step 4: Update new-task `onAttachFiles`**

Replace the body of `onAttachFiles(input)` with:

```js
async function onAttachFiles(input) {
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  _attachError = "";
  _attachUploading += files.length;
  setAttachmentSubmitDisabled(true);
  renderAttachChips();
  for (const f of files) {
    try {
      const uploaded = await uploadTaskAttachmentFile(f);
      if (uploaded.path && !_attachments.some(a => a.path === uploaded.path)) _attachments.push(uploaded);
    } catch (err) {
      _attachError = err?.message || "Attachment upload failed";
    } finally {
      _attachUploading = Math.max(0, _attachUploading - 1);
      renderAttachChips();
    }
  }
  setAttachmentSubmitDisabled(hasPendingAttachmentUploads());
}
```

Update `removeAttach` and `renderAttachChips` to use `_attachments` and `attachmentName(a)`. The hint must show `"Uploading..."` while `_attachUploading > 0`, the error text if `_attachError`, otherwise `"No files selected"`.

- [ ] **Step 5: Update create-task submission**

In `createTask()`, before formatting attachments, add:

```js
if (hasPendingAttachmentUploads()) { err.textContent = "Attachment upload is still in progress."; return; }
if (_attachError) { err.textContent = _attachError; return; }
```

Replace:

```js
if (_attachPaths.length) description += "\n\nAttached files:\n" + _attachPaths.map(p => "- " + p).join("\n");
```

with:

```js
description = appendAttachmentBlockText(description, _attachments);
```

After successful creation, replace:

```js
_attachPaths = []; renderAttachChips();
```

with:

```js
_attachments = []; _attachError = ""; renderAttachChips();
```

- [ ] **Step 6: Update retry/reply attachment state**

Add:

```js
let _ctxUploading = { retry: 0, reply: 0 };
let _ctxAttachError = { retry: "", reply: "" };
```

Change `onCtxAttach(ctx, input)` into an async uploader mirroring `onAttachFiles()`:

```js
async function onCtxAttach(ctx, input) {
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  _ctxAttachError[ctx] = "";
  _ctxUploading[ctx] += files.length;
  setAttachmentSubmitDisabled(true);
  renderCtxChips(ctx);
  for (const f of files) {
    try {
      const uploaded = await uploadTaskAttachmentFile(f);
      if (uploaded.path && !_ctxAttach[ctx].some(a => a.path === uploaded.path)) _ctxAttach[ctx].push(uploaded);
    } catch (err) {
      _ctxAttachError[ctx] = err?.message || "Attachment upload failed";
    } finally {
      _ctxUploading[ctx] = Math.max(0, _ctxUploading[ctx] - 1);
      renderCtxChips(ctx);
    }
  }
  setAttachmentSubmitDisabled(hasPendingAttachmentUploads());
}
```

Update `renderCtxChips(ctx)` to render records with `attachmentName(a)`, show `"Uploading..."` while `_ctxUploading[ctx] > 0`, show the context error if present, otherwise `"No files"`.

- [ ] **Step 7: Update retry/reply submissions**

In `submitRetry(id)` and `replyTask(id)`, block while upload is pending:

```js
if (hasPendingAttachmentUploads()) { hmAlert("Attachment upload is still in progress."); return; }
if (_ctxAttachError.retry) { hmAlert(_ctxAttachError.retry); return; }
```

For reply, do not concatenate attachment text in the browser. Send structured records:

```js
const r = await api("/tasks/"+id+"/reply", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, attachments }),
});
```

For retry, continue sending `{ steer, attachments }`; the server formats them.

- [ ] **Step 8: Run console tests to verify GREEN**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run focused attachment flow tests**

Run:

```bash
node --import tsx/esm --test src/lib/tasks/attachments.test.ts src/lib/tasks/reply-continuation.test.ts src/daemon/console.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/daemon/console.ts src/daemon/console.test.ts
git commit -m "fix(console): upload task attachments before launch"
```

---

### Task 4: Full Verification, Release Commit, And Autoupdate Build

**Files:**
- No new production files unless verification reveals a defect.
- Release script will modify version files and publish release assets.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: pushed `main`, GitHub Release, signed updater artifacts, live `latest.json`.

- [ ] **Step 1: Run required verification gates**

Run:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
npx tsx scripts/qwen-readiness.mts
```

Expected: all commands exit 0. `qwen-readiness` must report all readiness checks passing.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status -sb
git log --oneline --decorate -8
git diff --stat origin/main..HEAD
```

Expected: only the spec, plan, and attachment-provider-parity implementation commits are ahead of `origin/main`.

- [ ] **Step 3: Commit the implementation plan if not already committed**

```bash
git add docs/superpowers/plans/2026-06-19-task-attachment-provider-parity.md
git commit -m "docs: plan task attachment provider parity"
```

Expected: plan doc is committed before implementation release.

- [ ] **Step 4: Run the release/autoupdate flow**

Run:

```bash
node scripts/release.mjs
```

Expected:
- version bumps from the current package version to the next patch version;
- release commit is created and pushed to `origin/main`;
- signed/notarized app and DMG build succeeds;
- GitHub Release `v<new version>` is created;
- `npm run release:verify` passes and proves the live `latest.json` feed points at HEAD.

- [ ] **Step 5: Final status proof**

Run:

```bash
git status -sb
npm run release:verify
gh release view --repo irvencassio/hivematrix --json tagName,url,publishedAt
```

Expected: clean `main...origin/main`, release proof passes, and GitHub reports the new release URL.
