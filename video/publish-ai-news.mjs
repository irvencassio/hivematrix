#!/usr/bin/env node
/**
 * End-to-end AI news avatar publisher:
 * news-script -> make-avatar -> publish.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(VIDEO_DIR, "out");

function stamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function defaultOutPaths(date = new Date()) {
  const basename = `ai-news-${stamp(date)}`;
  return {
    basename,
    script: join(OUT_DIR, `${basename}-script.txt`),
    title: join(OUT_DIR, `${basename}-title.txt`),
    description: join(OUT_DIR, `${basename}-description.txt`),
    tags: join(OUT_DIR, `${basename}-tags.txt`),
    headlines: join(OUT_DIR, `${basename}-headlines.json`),
    video: join(OUT_DIR, `${basename}-avatar.mp4`),
  };
}

export function buildPipelineCommands({
  paths,
  privacy = "unlisted",
  kind = "avatar",
  dryRun = false,
  skipRender = false,
  skipUpload = false,
  source = "auto",
  writer = "auto",
} = {}) {
  const commands = [{
    label: "news",
    args: [
      "news-script.mjs",
      "--script-out", paths.script,
      "--title-out", paths.title,
      "--description-out", paths.description,
      "--tags-out", paths.tags,
      "--headlines-out", paths.headlines,
      "--source", source,
      "--writer", writer,
    ],
  }];
  if (dryRun) return commands;
  if (!skipRender) commands.push({ label: "render", args: ["make-avatar.mjs", paths.script, paths.video] });
  if (!skipUpload) {
    commands.push({
      label: "upload",
      args: [
        "publish.mjs",
        paths.video,
        "--title-file", paths.title,
        "--description-file", paths.description,
        "--tags-file", paths.tags,
        "--privacy", privacy,
        "--kind", kind,
      ],
    });
  }
  return commands;
}

function parseArgs(argv) {
  const flag = (name, def = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
  };
  const has = (name) => argv.includes(name);
  const paths = defaultOutPaths(new Date(flag("--date", new Date().toISOString())));
  paths.video = flag("--video", paths.video);
  return {
    paths,
    privacy: flag("--privacy", "unlisted"),
    kind: flag("--kind", "avatar"),
    source: flag("--source", "auto"),
    writer: flag("--writer", "auto"),
    dryRun: has("--dry-run"),
    skipRender: has("--skip-render"),
    skipUpload: has("--skip-upload"),
  };
}

function runCommand(command) {
  console.log(`-> ${command.label}: node ${command.args.join(" ")}`);
  execFileSync(process.execPath, command.args, { cwd: VIDEO_DIR, stdio: "inherit" });
}

function preview(paths) {
  const title = existsSync(paths.title) ? readFileSync(paths.title, "utf-8").trim() : "(missing)";
  const script = existsSync(paths.script) ? readFileSync(paths.script, "utf-8").trim() : "(missing)";
  console.log(`\nDry run complete: ${title}`);
  console.log(`script: ${paths.script}`);
  console.log(`video target: ${paths.video}`);
  console.log(`\n${script.slice(0, 700)}${script.length > 700 ? "..." : ""}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.skipRender && !existsSync(opts.paths.video) && !opts.skipUpload) {
    console.error(`--skip-render needs an existing video: ${opts.paths.video}`);
    process.exit(2);
  }
  for (const command of buildPipelineCommands(opts)) runCommand(command);
  if (opts.dryRun) preview(opts.paths);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

