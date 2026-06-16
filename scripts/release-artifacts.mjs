import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export function selectReleaseDmg(bundleDir, version, arch = "aarch64") {
  const publicName = `HiveMatrix_${version}_${arch}.dmg`;
  const customDmg = join(bundleDir, `HiveMatrix-${version}.dmg`);
  if (existsSync(customDmg)) {
    return { sourcePath: customDmg, assetName: publicName };
  }

  const dmgDir = join(bundleDir, "dmg");
  if (!existsSync(dmgDir)) return null;
  const candidates = readdirSync(dmgDir)
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => join(dmgDir, name));
  if (candidates.length === 0) return null;

  const exact = candidates.find((path) => basename(path) === publicName);
  const sourcePath = exact ?? candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return { sourcePath, assetName: basename(sourcePath) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , command, bundleDir, version] = process.argv;
  if (!bundleDir || !version) {
    console.error("usage: node scripts/release-artifacts.mjs dmg-tsv <bundle-dir> <version>");
    process.exit(2);
  }
  const dmg = selectReleaseDmg(bundleDir, version);
  if (!dmg) process.exit(0);
  if (command === "dmg-tsv") {
    console.log(`${dmg.sourcePath}\t${dmg.assetName}`);
  } else {
    console.error(`unknown command: ${command}`);
    process.exit(2);
  }
}

