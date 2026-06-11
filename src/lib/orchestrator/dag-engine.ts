/**
 * DAG Engine — pure functions for mission dependency graph operations.
 * No side effects, no DB access. Takes arrays of tasks and returns decisions.
 */

export interface DagTask {
  _id: string;
  status: string;
  dependsOn: string[];
}

/**
 * Validate that the task dependency graph is acyclic using Kahn's algorithm.
 * Returns { valid: true } if acyclic, or { valid: false, cycle: [...] } with
 * the IDs involved in the cycle.
 */
export function validateDag(tasks: DagTask[]): { valid: boolean; cycle?: string[] } {
  const taskIds = new Set(tasks.map((t) => t._id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task._id, 0);
    adjacency.set(task._id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) continue; // skip unknown deps
      adjacency.get(dep)!.push(task._id);
      inDegree.set(task._id, (inDegree.get(task._id) ?? 0) + 1);
    }
  }

  // Kahn's: process nodes with in-degree 0
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (processed === tasks.length) {
    return { valid: true };
  }

  // Remaining nodes with in-degree > 0 are part of a cycle
  const cycle = Array.from(inDegree.entries())
    .filter(([, deg]) => deg > 0)
    .map(([id]) => id);

  return { valid: false, cycle };
}

/**
 * Return task IDs whose dependencies are ALL in terminal-success status ("done")
 * AND the task itself is in "pending_mission" status (waiting to be promoted).
 */
export function getEligibleTasks(tasks: DagTask[]): string[] {
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t._id));

  return tasks
    .filter((t) => {
      if (t.status !== "pending_mission") return false;
      // Root tasks (no deps) are always eligible
      if (t.dependsOn.length === 0) return true;
      // All dependencies must be done
      return t.dependsOn.every((dep) => doneIds.has(dep));
    })
    .map((t) => t._id);
}

/**
 * Return true if all mission tasks have reached terminal status ("done").
 */
export function isMissionComplete(tasks: DagTask[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.status === "done");
}

/**
 * Return task IDs that are in terminal failure state — "failed" status.
 * These are tasks that have failed and won't auto-retry via the existing
 * transient failure detection.
 */
export function getTerminalFailures(tasks: DagTask[]): string[] {
  return tasks.filter((t) => t.status === "failed").map((t) => t._id);
}
