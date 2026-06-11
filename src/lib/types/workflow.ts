// Verbatim from Hive 1 — workflow step/definition types.
export interface WorkflowStep {
  id: string;
  label: string;
  promptPrefix: string;
}

export interface WorkflowDefinition {
  id: string;
  label?: string;
  stepIds: string[];
}

export interface ResolvedWorkflow {
  id: string;
  label?: string;
  steps: WorkflowStep[];
}

export const DEFAULT_STEPS: WorkflowStep[] = [
  { id: "standalone", label: "Single Task", promptPrefix: "" },
  { id: "brainstorm", label: "Brainstorm", promptPrefix: "Use the /workflows:brainstorm skill. " },
  { id: "plan", label: "Plan", promptPrefix: "Use the /workflows:plan skill. " },
  { id: "work", label: "Work", promptPrefix: "Use the /workflows:work skill. " },
];

export const DEFAULT_WORKFLOWS: WorkflowDefinition[] = [
  { id: "standalone", stepIds: ["standalone"] },
  { id: "brainstorm-plan-work", stepIds: ["brainstorm", "plan", "work"] },
  { id: "plan-work", stepIds: ["plan", "work"] },
  { id: "work-only", stepIds: ["work"] },
];

export function resolveWorkflowSteps(workflow: WorkflowDefinition, stepLibrary: WorkflowStep[]): ResolvedWorkflow {
  const stepMap = new Map(stepLibrary.map((s) => [s.id, s]));
  const steps = workflow.stepIds.map((id) => stepMap.get(id)).filter((s): s is WorkflowStep => !!s);
  return { id: workflow.id, label: workflow.label, steps };
}

export function getWorkflowLabel(workflow: ResolvedWorkflow): string {
  if (workflow.label) return workflow.label;
  if (workflow.steps.length === 1 && workflow.steps[0].id === "standalone") return workflow.steps[0].label;
  return workflow.steps.map((s) => s.label).join(" → ");
}

export function getNextStepId(workflow: ResolvedWorkflow, stepIndex: number): string | null {
  return workflow.steps[stepIndex + 1]?.id ?? null;
}

export const LEGACY_WORKFLOW_MAP: Record<string, { workflowId: string; stepIndex: number }> = {
  standalone: { workflowId: "standalone", stepIndex: 0 },
  brainstorm: { workflowId: "brainstorm-plan-work", stepIndex: 0 },
  plan: { workflowId: "plan-work", stepIndex: 0 },
  work: { workflowId: "work-only", stepIndex: 0 },
};
