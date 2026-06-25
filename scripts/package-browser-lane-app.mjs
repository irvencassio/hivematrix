#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const appRoot = join(root, "browser-lane-app");
const outputRoot = join(root, "build/browser-lane");
const appBundle = join(outputRoot, "Browser Lane.app");
const contents = join(appBundle, "Contents");
const macos = join(contents, "MacOS");
const resources = join(contents, "Resources");
const executable = join(appRoot, ".build/debug/BrowserLane");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result;
}

run("swift", ["build"], { cwd: appRoot, stdio: "inherit" });

rmSync(appBundle, { recursive: true, force: true });
mkdirSync(macos, { recursive: true });
mkdirSync(resources, { recursive: true });

copyFileSync(join(appRoot, "Resources/Info.plist"), join(contents, "Info.plist"));
copyFileSync(join(appRoot, "Resources/entitlements.plist"), join(resources, "entitlements.plist"));
copyFileSync(executable, join(macos, "BrowserLane"));
chmodSync(join(macos, "BrowserLane"), 0o755);

console.log(`Packaged ${appBundle}`);
