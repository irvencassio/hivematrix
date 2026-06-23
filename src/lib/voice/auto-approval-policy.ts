import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type AutoApprovalCategory = "checkpoint" | "lowRiskTool" | "content" | "external" | "tool" | "stuck" | "unknown";

export interface AutoApprovalPolicy {
  enabled: boolean;
  allowCheckpoints: boolean;
  allowLowRiskTools: boolean;
}

export interface AutoApprovalRequest {
  category: AutoApprovalCategory;
  toolName?: string;
}

export interface AutoApprovalDecision {
  allowed: boolean;
  reason: string;
}

const DEFAULT_POLICY: AutoApprovalPolicy = {
  enabled: false,
  allowCheckpoints: false,
  allowLowRiskTools: false,
};

const NEVER_AUTO_APPROVE = new Set<AutoApprovalCategory>(["content", "external", "tool", "stuck", "unknown"]);

function configPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bool(value: unknown): boolean {
  return value === true;
}

export function parseAutoApprovalPolicy(input: unknown): AutoApprovalPolicy {
  let record: unknown = input;
  if (typeof input === "string") {
    try {
      record = JSON.parse(input);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }
  if (!record || typeof record !== "object") return { ...DEFAULT_POLICY };
  const obj = record as Record<string, unknown>;
  return {
    enabled: bool(obj.enabled),
    allowCheckpoints: bool(obj.allowCheckpoints),
    allowLowRiskTools: bool(obj.allowLowRiskTools),
  };
}

export function getAutoApprovalPolicy(): AutoApprovalPolicy {
  const config = readConfig();
  return parseAutoApprovalPolicy(config.autoApproval);
}

export function setAutoApprovalPolicy(patch: Partial<AutoApprovalPolicy>): AutoApprovalPolicy {
  const config = readConfig();
  const next = parseAutoApprovalPolicy({ ...parseAutoApprovalPolicy(config.autoApproval), ...patch });
  config.autoApproval = next;
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return next;
}

export function classifyAutoApprovalRequest(request: { timestamp?: string; tool?: string }): AutoApprovalCategory {
  if (request.timestamp === "checkpoint-content") return "content";
  if (request.timestamp?.startsWith("checkpoint-")) return "checkpoint";
  return "tool";
}

export function evaluateAutoApprovalPolicy(policyInput: Partial<AutoApprovalPolicy> | unknown, request: AutoApprovalRequest): AutoApprovalDecision {
  const policy = parseAutoApprovalPolicy(policyInput);
  if (!policy.enabled) return { allowed: false, reason: "auto-approval is disabled" };
  if (NEVER_AUTO_APPROVE.has(request.category)) {
    return { allowed: false, reason: `${request.category} approvals require explicit review` };
  }
  if (request.category === "checkpoint") {
    return policy.allowCheckpoints
      ? { allowed: true, reason: "checkpoint auto-approval is enabled" }
      : { allowed: false, reason: "checkpoint auto-approval is not enabled" };
  }
  if (request.category === "lowRiskTool") {
    return policy.allowLowRiskTools
      ? { allowed: true, reason: "low-risk tool auto-approval is enabled" }
      : { allowed: false, reason: "low-risk tool auto-approval is not enabled" };
  }
  return { allowed: false, reason: "unknown approval category" };
}
