export const DEFAULT_TASK_PROJECT = "inbox";
export const LEGACY_SYSTEM_PROJECTS = new Set(["ops"]);
export const BUILTIN_SYSTEM_PROJECTS = new Set([DEFAULT_TASK_PROJECT, ...LEGACY_SYSTEM_PROJECTS, "messagebee", "brainpower"]);
export const VIRTUAL_PERSONAL_PROJECTS = new Set(["task", "idea", "goal"]);
