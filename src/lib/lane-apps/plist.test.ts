import test from "node:test";
import assert from "node:assert/strict";

import { parseInfoPlist } from "./plist";

const BROWSER_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.irvcassio.hivematrix.browserlane</string>
  <key>CFBundleExecutable</key>
  <string>BrowserLane</string>
  <key>CFBundleShortVersionString</key>
    <string>0.1.86</string>
  <key>CFBundleVersion</key>
    <string>2</string>
</dict>
</plist>`;

test("parseInfoPlist pulls version, build, and bundle id (tolerating whitespace)", () => {
  const parsed = parseInfoPlist(BROWSER_PLIST);
  assert.equal(parsed.short, "0.1.86");
  assert.equal(parsed.build, "2");
  assert.equal(parsed.bundleId, "com.irvcassio.hivematrix.browserlane");
});

test("parseInfoPlist returns null fields when keys are absent", () => {
  const parsed = parseInfoPlist("<plist><dict></dict></plist>");
  assert.equal(parsed.short, null);
  assert.equal(parsed.build, null);
  assert.equal(parsed.bundleId, null);
});
