import { readFileSync, writeFileSync, existsSync } from "fs";

const PID_FILE = `${process.env.HOME}/.hive/pids.json`;

interface PidEntry {
  taskId: string;
  pid: number;
  projectPath: string;
  startedAt: string;
}

function readRegistry(): PidEntry[] {
  try {
    if (!existsSync(PID_FILE)) return [];
    return JSON.parse(readFileSync(PID_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeRegistry(entries: PidEntry[]) {
  writeFileSync(PID_FILE, JSON.stringify(entries, null, 2));
}

export function registerPid(taskId: string, pid: number, projectPath: string) {
  const entries = readRegistry();
  entries.push({ taskId, pid, projectPath, startedAt: new Date().toISOString() });
  writeRegistry(entries);
}

export function unregisterPid(pid: number) {
  const entries = readRegistry().filter((e) => e.pid !== pid);
  writeRegistry(entries);
}

export function getRegisteredPids(): PidEntry[] {
  return readRegistry();
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getStaleEntries(): PidEntry[] {
  return readRegistry().filter((e) => !isProcessAlive(e.pid));
}
