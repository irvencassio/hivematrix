import type { WorkerKind } from "@/lib/central/contracts";
import type { LaneId } from "@/lib/lanes/contracts";

// HiveMatrix capability lane catalog — scoped per COMPONENT-MAP.md.
// Public surfaces use lane names; internal worker kinds keep legacy identifiers
// for compatibility with persisted tasks, routes, and module boundaries.

export type LaneRole = "channel" | "capability" | "meta" | "workflow";

export interface LaneDefinition {
  kind: WorkerKind | LaneId;
  name: string;
  role: LaneRole;
  phase: 1 | 2 | 3 | 4;
  summary: string;
  capabilities: string[];
  standalone: boolean;
}

const LANE_DEFINITIONS: LaneDefinition[] = [
  {
    kind: "messagebee",
    name: "Message Lane",
    role: "channel",
    phase: 1,
    summary: "SMS/iMessage in and out. Reads Messages chat.db (Full Disk Access) and sends via osascript; allowlisted senders route to needs_input replies or new tasks.",
    capabilities: ["imessage-in", "imessage-out", "sms", "needs-input-reply", "sender-allowlist"],
    standalone: false,
  },
  {
    kind: "mailbee",
    name: "Mail Lane",
    role: "channel",
    phase: 1,
    summary: "Email watch + trust-gated drafting via Apple Mail (osascript). Every inbound is trust-classified (prompt-injection + risky-attachment detection); auto-send only for trusted senders, else draft-for-approval.",
    capabilities: ["email-watch", "trust-classification", "draft-for-approval", "apple-mail"],
    standalone: false,
  },
  {
    kind: "webbee",
    name: "Browser Lane Read",
    role: "capability",
    phase: 1,
    summary: "Browser Lane read/search mode for fresh retrieval, citations, and current facts. Disabled in offline mode.",
    capabilities: ["fresh-public-data", "citations", "news", "current-facts"],
    standalone: false,
  },
  {
    kind: "review",
    name: "Review Lane",
    role: "meta",
    phase: 1,
    summary: "Control-plane coordination for planning, routing, review, diagnostics, and worker setup.",
    capabilities: ["routing", "planning", "review", "worker-diagnostics", "setup"],
    standalone: true,
  },
  {
    kind: "brainbee",
    name: "Memory Lane",
    role: "meta",
    phase: 1,
    summary: "Canonical memory compilation, retrieval hygiene, and durable playbook upkeep.",
    capabilities: ["memory-bundles", "playbook-hygiene", "recap-compilation", "reference-curation"],
    standalone: true,
  },
  {
    kind: "browserbee",
    name: "Browser Lane Workflow",
    role: "capability",
    phase: 2,
    summary: "Browser Lane workflow mode for authenticated, rendered, or stateful web workflows.",
    capabilities: ["browser-navigation", "stateful-web-workflows", "screenshots", "browser-traces"],
    standalone: false,
  },
  {
    kind: "termbee",
    name: "Terminal Lane",
    role: "capability",
    phase: 1,
    summary: "Persistent terminal sessions the agent drives across turns (real shells, no native deps). Available in every connectivity mode — the offline workhorse.",
    capabilities: ["persistent-shell", "run-command", "scrollback", "offline"],
    standalone: false,
  },
  {
    kind: "desktopbee",
    name: "Desktop Lane",
    role: "capability",
    phase: 3,
    summary: "Approval-heavy native desktop automation via Swift helper: AppleScript-first → AX semantic → vision last resort.",
    capabilities: ["desktop-automation", "ax-tree-actions", "applescript", "desktop-use-traces"],
    standalone: true,
  },
];

const LANE_DEFINITION_MAP = new Map(LANE_DEFINITIONS.map((definition) => [definition.kind, definition]));

// Deprecated kind strings that map to a canonical lane definition.
// Kept for one migration window so old workers and persisted records still resolve.
const COMPATIBILITY_KIND_MAP = new Map<string, LaneDefinition>([
  ["managerbee", LANE_DEFINITIONS.find((d) => d.kind === "review")!],
]);

export const FIRST_WORKER_SET = LANE_DEFINITIONS.filter((definition) => definition.phase === 1);
export const CAPABILITY_SUBSTRATE_SET = LANE_DEFINITIONS.filter((definition) => definition.phase === 2);
export const HIGHER_RISK_SURFACE_SET = LANE_DEFINITIONS.filter((definition) => definition.phase === 3);

export function listLaneDefinitions(): LaneDefinition[] {
  return [...LANE_DEFINITIONS];
}

export function getLaneDefinition(kind: WorkerKind | string | null | undefined): LaneDefinition | null {
  if (!kind) return null;
  return LANE_DEFINITION_MAP.get(kind as WorkerKind) ?? COMPATIBILITY_KIND_MAP.get(kind) ?? null;
}
