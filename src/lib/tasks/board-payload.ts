const BOARD_LOG_LIMIT = 5;

function trimBoardLogs(logs: unknown): unknown {
  return Array.isArray(logs) ? logs.slice(-BOARD_LOG_LIMIT) : logs;
}

export function toBoardTaskPayload<T extends Record<string, unknown>>(task: T): T {
  const lite: Record<string, unknown> = { ...task };
  if ("logs" in lite) lite.logs = trimBoardLogs(lite.logs);
  if ("turns" in lite) lite.turns = [];
  return lite as T;
}

export function toBoardTaskUpdateFields<T extends Record<string, unknown>>(fields: T): T {
  return toBoardTaskPayload(fields);
}
