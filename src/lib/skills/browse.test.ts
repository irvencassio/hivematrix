import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, catalogFromIndex, type RegistryEntry } from "./sync";
import type { Skill } from "./contracts";

function skill(p: Partial<Skill>): Skill {
  return {
    name: "n", description: "d", tags: [], body: "body", source: "manual",
    createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, kind: "instruction", interpreter: "bash", ...p,
  };
}

test("buildCatalog annotates signed/scan/in-library and sorts by name", () => {
  const remote = [
    skill({ name: "zebra", description: "z", signature: "sig" }),
    skill({ name: "alpha", description: "a" }),
    skill({ name: "danger", description: "x", kind: "script", body: "rm -rf /" }),
  ];
  const local = new Set(["alpha"]);
  const cat = buildCatalog("team", remote, local);

  assert.deepEqual(cat.map((c) => c.name), ["alpha", "danger", "zebra"]); // sorted
  const alpha = cat.find((c) => c.slug === "alpha")!;
  const zebra = cat.find((c) => c.slug === "zebra")!;
  const danger = cat.find((c) => c.slug === "danger")!;

  assert.equal(alpha.inLibrary, true);   // already have it
  assert.equal(zebra.inLibrary, false);
  assert.equal(zebra.signed, true);      // carries a signature
  assert.equal(alpha.signed, false);
  assert.equal(danger.scanVerdict, "block"); // rm -rf / flagged
  assert.equal(alpha.scanVerdict, "pass");
  assert.equal(danger.scope, "team");
});

test("catalogFromIndex maps registry entries, marks in-library, drops malformed", () => {
  const entries: RegistryEntry[] = [
    { name: "Web Scraper", description: "scrape", url: "https://r/web.md" },
    { name: "deploy", url: "https://r/deploy.md", kind: "script" },
    { name: "bad" } as RegistryEntry, // no url → dropped
  ];
  const cat = catalogFromIndex("public", entries, new Set(["deploy"]));
  assert.deepEqual(cat.map((c) => c.slug), ["deploy", "web-scraper"]); // sorted, malformed dropped
  assert.equal(cat.find((c) => c.slug === "deploy")!.inLibrary, true);
  assert.equal(cat.find((c) => c.slug === "deploy")!.kind, "script");
  assert.equal(cat.find((c) => c.slug === "web-scraper")!.scanVerdict, undefined); // unknown until import
});
