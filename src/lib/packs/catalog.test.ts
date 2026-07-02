import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { buildSignedCatalogPack } from "./builder";
import { getPackCatalog, getPackCatalogEntry, PACK_CATALOG } from "./catalog";
import { parseHmpack } from "./parser";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

test("catalog exposes the four Phase 4 first-party packs", () => {
  assert.deepEqual(getPackCatalog().map((pack) => pack.id), [
    "support-inbox",
    "chief-of-staff",
    "content-engine",
    "dev-copilot",
  ]);
  for (const pack of getPackCatalog()) {
    assert.equal(pack.description.length > 20, true);
    assert.equal(pack.dashboardCard.metrics.length >= 3, true);
    assert.equal(pack.requires.lanes.length > 0, true);
  }
});

test("every catalog entry signs into a verifier-accepted hmpack", () => {
  for (const entry of PACK_CATALOG) {
    const buffer = buildSignedCatalogPack(entry, PRIV_PEM);
    const parsed = parseHmpack(buffer, PUB_PEM);
    assert.ok(parsed.ok, parsed.ok ? "" : `${entry.id}: ${parsed.error}`);
    assert.equal(parsed.pack.manifest.name, entry.manifest.name);
    assert.deepEqual(Object.keys(parsed.pack.skills).sort(), entry.manifest.skills.slice().sort());
    assert.deepEqual(Object.keys(parsed.pack.directives).sort(), entry.manifest.directives.slice().sort());
  }
});

test("catalog lookup accepts ids and manifest names", () => {
  assert.equal(getPackCatalogEntry("support-inbox")?.manifest.name, "support-inbox");
  assert.equal(getPackCatalogEntry("Chief-Of-Staff")?.id, "chief-of-staff");
  assert.equal(getPackCatalogEntry("missing"), null);
});
