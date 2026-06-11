import { DEFAULT_TASK_PROJECT, VIRTUAL_PERSONAL_PROJECTS } from "./project-constants";

export function sortProjects(keys: string[]): string[] {
  return keys.sort((a, b) => a.localeCompare(b));
}

export function getTaskProjectOptions(realProjects: string[], personalTasksEnabled: boolean): string[] {
  const projects = personalTasksEnabled
    ? [DEFAULT_TASK_PROJECT, ...realProjects, ...VIRTUAL_PERSONAL_PROJECTS]
    : [DEFAULT_TASK_PROJECT, ...realProjects];
  return sortProjects([...new Set(projects)]);
}

export function getMissionProjectOptions(realProjects: string[], personalTasksEnabled: boolean): string[] {
  const projects = personalTasksEnabled
    ? [...realProjects, "ops", ...VIRTUAL_PERSONAL_PROJECTS]
    : [...realProjects, "ops"];
  return sortProjects([...new Set(projects)]);
}

export function getDefaultTaskProject(realProjects: string[], selectableProjects: string[]): string {
  if (realProjects.length === 1) return realProjects[0];
  return selectableProjects[0] ?? DEFAULT_TASK_PROJECT;
}

export function shouldShowTaskProjectField({
  showAdvanced,
  realProjectCount,
  personalTasksEnabled,
  workflowRequiresProject = false,
}: {
  showAdvanced: boolean;
  realProjectCount: number;
  personalTasksEnabled: boolean;
  workflowRequiresProject?: boolean;
}): boolean {
  return showAdvanced || realProjectCount > 1 || personalTasksEnabled || workflowRequiresProject;
}
