import assert from "node:assert/strict";
import test from "node:test";

// These legacy import paths/names must keep working for older callers while the
// implementation lives under @/lib/lanes/*. New code should import the Lane*
// names directly; this guards the compatibility facades.
import { getBeeDefinition, listBeeDefinitions, type BeeDefinition } from "@/lib/bees/catalog";
import {
  getBeeRuntimeDescriptor,
  embeddedHealthRoute,
  type BeeServiceStatus,
} from "@/lib/bees/service-manager";

test("bees/catalog facade re-exports the lane catalog under legacy names", () => {
  const defs: BeeDefinition[] = listBeeDefinitions();
  assert.ok(defs.length > 0);
  assert.equal(getBeeDefinition("messagebee")?.name, "Message Lane");
  assert.equal(getBeeDefinition("authbee"), null);
});

test("bees/service-manager facade re-exports the lane service manager under legacy names", () => {
  assert.equal(getBeeRuntimeDescriptor("desktopbee").runtimeMode, "embedded");
  assert.equal(embeddedHealthRoute("managerbee"), "/api/managerbee/health");
  // Type alias still resolves to the lane worker status shape.
  const status: BeeServiceStatus["runtimeMode"] = "embedded";
  assert.equal(status, "embedded");
});
