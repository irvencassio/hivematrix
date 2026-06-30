import test from "node:test";
import assert from "node:assert/strict";
import { parseAdoConfig, buildAdoMcpServer } from "./mcp";
import { parseFeatures, featureCapability } from "@/lib/config/features";

test("parseFeatures defaults flags off; reads true only for explicit true", () => {
  const base = { ado: false, voice: false, video: false, taskIntakeModelDecomposition: false, "openclaw.chatDock": false };
  assert.deepEqual(parseFeatures({}), base);
  assert.deepEqual(parseFeatures({ features: { ado: true } }), { ...base, ado: true });
  assert.deepEqual(parseFeatures({ features: { ado: "yes" } }), base);
  assert.deepEqual(parseFeatures({ features: { voice: true } }), { ...base, voice: true });
});

test("featureCapability gates heavy features on Apple Silicon + RAM", () => {
  assert.deepEqual(featureCapability("ado"), { capable: true });                        // light feature, always ok
  assert.equal(featureCapability("voice", { arch: "x64", ramGB: 64 }).capable, false);  // not Apple Silicon
  assert.equal(featureCapability("voice", { arch: "arm64", ramGB: 8 }).capable, false); // too little RAM
  assert.equal(featureCapability("voice", { arch: "arm64", ramGB: 64 }).capable, true);
  assert.equal(featureCapability("video", { arch: "arm64", ramGB: 128 }).capable, true);
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
