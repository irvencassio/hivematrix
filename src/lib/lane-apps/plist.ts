// Pure Info.plist value extraction. We intentionally avoid a full XML parser
// dependency: lane app Info.plist files are simple flat <dict> documents, and a
// targeted key→string read is enough and keeps this module dependency-free.

export interface ParsedInfoPlist {
  short: string | null;
  build: string | null;
  bundleId: string | null;
}

function readKey(xml: string, key: string): string | null {
  // Match `<key>NAME</key>` then the next `<string>VALUE</string>`, allowing
  // arbitrary whitespace/newlines between them (the lane plists indent oddly).
  const re = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`);
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

export function parseInfoPlist(xml: string): ParsedInfoPlist {
  return {
    short: readKey(xml, "CFBundleShortVersionString"),
    build: readKey(xml, "CFBundleVersion"),
    bundleId: readKey(xml, "CFBundleIdentifier"),
  };
}
