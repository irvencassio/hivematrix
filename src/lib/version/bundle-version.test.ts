import assert from "node:assert/strict";
import test from "node:test";

import { parseInfoPlistVersion, getBundledVersion } from "./bundle-version";
import { VERSION } from "@/lib/version";

const PLIST = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>HiveMatrix</string>
  <key>CFBundleShortVersionString</key><string>1.4.2</string>
  <key>CFBundleVersion</key><string>1.4.2</string>
</dict></plist>`;

const INSTALLED = "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const DEV = "/Users/irv/.nvm/versions/node/v22.22.3/bin/node";

test("parseInfoPlistVersion pulls CFBundleShortVersionString", () => {
  assert.equal(parseInfoPlistVersion(PLIST), "1.4.2");
  assert.equal(parseInfoPlistVersion("<plist></plist>"), null);
});

test("getBundledVersion reads Info.plist when bundled", () => {
  const v = getBundledVersion(INSTALLED, (p) => {
    assert.equal(p, "/Applications/HiveMatrix.app/Contents/Info.plist");
    return PLIST;
  });
  assert.equal(v, "1.4.2");
});

test("getBundledVersion falls back to compiled-in VERSION in a dev run", () => {
  assert.equal(getBundledVersion(DEV, () => { throw new Error("no plist"); }), VERSION);
});

test("getBundledVersion falls back when Info.plist lacks the key", () => {
  assert.equal(getBundledVersion(INSTALLED, () => "<plist></plist>"), VERSION);
});
