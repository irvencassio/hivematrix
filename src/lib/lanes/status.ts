import { listLaneWorkerStatuses, setLaneWorkerAutoStart, getLaneWorkerRuntimeDescriptor, type LaneWorkerStatus } from "@/lib/lanes/service-manager";
import { laneDisplayName, type LaneId } from "./contracts";

export interface LaneServiceStatus {
  kind: string;
  name: string;
  runtimeMode: LaneWorkerStatus["runtimeMode"];
  manageable: boolean;
  running: boolean;
  healthy: boolean | null;
  summary: string;
  statusDetail: string | null;
}

const STATUS_KIND_TO_LANE: Record<string, LaneId> = {
  browserbee: "browser",
  webbee: "browser",
  desktopbee: "desktop",
  termbee: "terminal",
  mailbee: "mail",
  messagebee: "message",
  brainbee: "memory",
  managerbee: "review",
};

export async function listLaneServiceStatuses(): Promise<LaneServiceStatus[]> {
  return shapeLaneServiceStatuses(await listLaneWorkerStatuses());
}

export function shapeLaneServiceStatuses(statuses: LaneWorkerStatus[]): LaneServiceStatus[] {
  const lanes = new Map<string, LaneServiceStatus>();

  for (const status of statuses) {
    const laneId = STATUS_KIND_TO_LANE[status.kind];
    const kind = laneId ?? status.kind;
    const name = laneId ? laneDisplayName(laneId) : status.name;
    const existing = lanes.get(kind);
    if (!existing) {
      lanes.set(kind, {
        kind,
        name,
        runtimeMode: status.runtimeMode,
        manageable: status.manageable,
        running: status.running,
        healthy: status.healthy,
        summary: status.summary,
        statusDetail: status.statusDetail,
      });
      continue;
    }

    existing.manageable = existing.manageable || status.manageable;
    existing.running = existing.running || status.running;
    existing.healthy = combineHealth(existing.healthy, status.healthy);
    existing.summary = joinUnique(existing.summary, status.summary);
    existing.statusDetail = joinNullable(existing.statusDetail, status.statusDetail);
    if (existing.runtimeMode !== status.runtimeMode) existing.runtimeMode = "embedded";
  }

  return [...lanes.values()];
}

export function setLaneAutoStart(kind: string, enabled: boolean) {
  const workerKind = laneKindToManagedWorkerKind(kind);
  if (!workerKind) return null;
  return setLaneWorkerAutoStart(workerKind, enabled);
}

export function getLaneRuntimeDescriptor(kind: string) {
  const workerKind = laneKindToManagedWorkerKind(kind) ?? kind;
  return getLaneWorkerRuntimeDescriptor(workerKind);
}

function laneKindToManagedWorkerKind(kind: string): string | null {
  switch (kind) {
    case "mail":
      return "mailbee";
    case "message":
      return "messagebee";
    case "desktop":
      return "desktopbee";
    case "terminal":
      return "termbee";
    case "browser":
      return "browserbee";
    case "memory":
      return "brainbee";
    case "review":
      return "managerbee";
    default:
      return kind.endsWith("bee") ? kind : null;
  }
}

function combineHealth(left: boolean | null, right: boolean | null): boolean | null {
  if (left === false || right === false) return false;
  if (left === true || right === true) return true;
  return null;
}

function joinNullable(left: string | null, right: string | null): string | null {
  const joined = joinUnique(left ?? "", right ?? "");
  return joined || null;
}

function joinUnique(left: string, right: string): string {
  const parts = [left, right].map((part) => part.trim()).filter(Boolean);
  return [...new Set(parts)].join("; ");
}
