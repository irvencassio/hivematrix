import type { WorkerKind } from "@/lib/central/contracts";

// HiveMatrix bee catalog — scoped per COMPONENT-MAP.md.
// Active channel: MessageBee (Q8, SMS/iMessage). Removed: VoiceBee, TubeBee
// (deferred), MailBee (deferred beyond notifications), ComputerBee (renamed
// DesktopBee), AuthBee (internal session plane, no public brand).

export type BeeRole = "channel" | "capability" | "meta" | "workflow";

export interface BeeDefinition {
  kind: WorkerKind;
  name: string;
  role: BeeRole;
  phase: 1 | 2 | 3 | 4;
  summary: string;
  capabilities: string[];
  standalone: boolean;
}

const BEE_DEFINITIONS: BeeDefinition[] = [
  {
    kind: "messagebee",
    name: "MessageBee",
    role: "channel",
    phase: 1,
    summary: "SMS/iMessage in and out. Reads Messages chat.db (Full Disk Access) and sends via osascript; allowlisted senders route to needs_input replies or new tasks.",
    capabilities: ["imessage-in", "imessage-out", "sms", "needs-input-reply", "sender-allowlist"],
    standalone: false,
  },
  {
    kind: "webbee",
    name: "WebBee",
    role: "capability",
    phase: 1,
    summary: "Embedded Hive read-only web lane for fresh retrieval, citations, and current facts. Disabled in offline mode.",
    capabilities: ["fresh-public-data", "citations", "news", "current-facts"],
    standalone: false,
  },
  {
    kind: "managerbee",
    name: "ManagerBee",
    role: "meta",
    phase: 1,
    summary: "Control-plane coordination for planning, routing, review, diagnostics, and worker setup.",
    capabilities: ["routing", "planning", "review", "worker-diagnostics", "setup"],
    standalone: true,
  },
  {
    kind: "brainbee",
    name: "BrainBee",
    role: "meta",
    phase: 1,
    summary: "Canonical memory compilation, retrieval hygiene, and durable playbook upkeep.",
    capabilities: ["memory-bundles", "playbook-hygiene", "recap-compilation", "reference-curation"],
    standalone: true,
  },
  {
    kind: "browserbee",
    name: "BrowserBee",
    role: "capability",
    phase: 2,
    summary: "Embedded Hive browser lane for authenticated, rendered, or stateful web workflows.",
    capabilities: ["browser-navigation", "stateful-web-workflows", "screenshots", "browser-traces"],
    standalone: false,
  },
  {
    kind: "desktopbee",
    name: "DesktopBee",
    role: "capability",
    phase: 3,
    summary: "Approval-heavy native desktop automation via Swift helper: AppleScript-first → AX semantic → vision last resort.",
    capabilities: ["desktop-automation", "ax-tree-actions", "applescript", "desktop-use-traces"],
    standalone: true,
  },
];

const BEE_DEFINITION_MAP = new Map(BEE_DEFINITIONS.map((definition) => [definition.kind, definition]));

export const FIRST_WORKER_SET = BEE_DEFINITIONS.filter((definition) => definition.phase === 1);
export const CAPABILITY_SUBSTRATE_SET = BEE_DEFINITIONS.filter((definition) => definition.phase === 2);
export const HIGHER_RISK_SURFACE_SET = BEE_DEFINITIONS.filter((definition) => definition.phase === 3);

export function listBeeDefinitions(): BeeDefinition[] {
  return [...BEE_DEFINITIONS];
}

export function getBeeDefinition(kind: WorkerKind | string | null | undefined): BeeDefinition | null {
  if (!kind) return null;
  return BEE_DEFINITION_MAP.get(kind as WorkerKind) ?? null;
}
