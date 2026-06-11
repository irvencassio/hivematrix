type DoneVisibilityTask = {
  status: string;
  missionId?: string | null;
  scheduledTaskId?: string | null;
};

export function isScheduledMissionRun(task: Pick<DoneVisibilityTask, "scheduledTaskId">): boolean {
  return typeof task.scheduledTaskId === "string" && task.scheduledTaskId.trim().length > 0;
}

export function isBoardVisibleDoneTask(task: DoneVisibilityTask): boolean {
  return task.status === "done" && (!task.missionId || isScheduledMissionRun(task));
}

export function isHiddenMissionDoneTask(task: DoneVisibilityTask): boolean {
  return task.status === "done" && Boolean(task.missionId) && !isScheduledMissionRun(task);
}
