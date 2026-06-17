import test from "node:test";
import assert from "node:assert/strict";
import { parseAdoConfig, buildAdoMcpServer } from "./mcp";
import { parseFeatures } from "@/lib/config/features";

test("parseFeatures defaults flags off; reads true only for explicit true", () => {
  assert.deepEqual(parseFeatures({}), { ado: false, voice: false, video: false });
  assert.deepEqual(parseFeatures({ features: { ado: true } }), { ado: true, voice: false, video: false });
  assert.deepEqual(parseFeatures({ features: { ado: "yes" } }), { ado: false, voice: false, video: false });
  assert.deepEqual(parseFeatures({ features: { voice: true } }), { ado: false, voice: true, video: false });
});

test("parseAdoConfig requires an org; defaults authMode to azcli (Entra)", () => {
  assert.equal(parseAdoConfig({}), null);
  assert.equal(parseAdoConfig({ ado: { authMode: "pat" } }), null, "no org → null");
  assert.deepEqual(parseAdoConfig({ ado: { org: "myorg" } }), { org: "myorg", authMode: "azcli" });
  assert.deepEqual(parseAdoConfig({ ado: { org: " myorg ", authMode: "pat" } }), { org: "myorg", authMode: "pat" });
  assert.equal(parseAdoConfig({ ado: { org: "o", authMode: "bogus" } })!.authMode, "azcli", "invalid mode → azcli");
});

test("buildAdoMcpServer builds the official local npx stdio server", () => {
  const s = buildAdoMcpServer({ org: "contoso", authMode: "azcli" });
  assert.equal(s.name, "azure-devops");
  assert.equal(s.transport, "stdio");
  assert.equal(s.command, "npx");
  assert.deepEqual(s.args, ["-y", "@azure-devops/mcp", "contoso", "--authentication", "azcli"]);
});
