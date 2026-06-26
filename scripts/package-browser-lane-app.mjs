#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Stamp the bundled Info.plist's HMBuildId with the source commit so two builds
// of the same version string still differ by build identity (defeats stale
// /Applications shadowing). Falls back to "dev" outside a git checkout.
function stampBuildId(infoPlistPath, repoRoot) {
  let commit = "dev";
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) commit = r.stdout.trim();
  const xml = readFileSync(infoPlistPath, "utf8");
  const stamped = xml.replace(
    /(<key>HMBuildId<\/key>\s*<string>)[\s\S]*?(<\/string>)/,
    `$1${commit}$2`,
  );
  writeFileSync(infoPlistPath, stamped);
  return commit;
}

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const appRoot = join(root, "browser-lane-app");
const outputRoot = join(root, "build/browser-lane");
const appBundle = join(outputRoot, "Browser Lane.app");
const contents = join(appBundle, "Contents");
const macos = join(contents, "MacOS");
const resources = join(contents, "Resources");
const executable = join(appRoot, ".build/release/BrowserLane");

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

run("swift", ["build", "-c", "release"], { cwd: appRoot, stdio: "inherit" });

rmSync(appBundle, { recursive: true, force: true });
mkdirSync(macos, { recursive: true });
mkdirSync(resources, { recursive: true });

copyFileSync(join(appRoot, "Resources/Info.plist"), join(contents, "Info.plist"));
const buildId = stampBuildId(join(contents, "Info.plist"), root);
copyFileSync(join(appRoot, "Resources/entitlements.plist"), join(resources, "entitlements.plist"));
copyFileSync(join(appRoot, "Resources/BrowserLane.icns"), join(resources, "BrowserLane.icns"));
copyFileSync(join(appRoot, "Resources/BrowserLaneWhite.icns"), join(resources, "BrowserLaneWhite.icns"));
copyFileSync(executable, join(macos, "BrowserLane"));
chmodSync(join(macos, "BrowserLane"), 0o755);

console.log(`Packaged ${appBundle} (HMBuildId=${buildId})`);
