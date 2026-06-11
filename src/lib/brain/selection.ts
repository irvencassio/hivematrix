export interface BrainSelectionState {
  task: string[];
  mission: string[];
  session: string[];
}

export const EMPTY_BRAIN_SELECTION: BrainSelectionState = {
  task: [],
  mission: [],
  session: [],
};

function normalizeBucket(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().replace(/^\/+/, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
}

export function normalizeBrainSelection(value: unknown): BrainSelectionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_BRAIN_SELECTION };
  }

  const record = value as Partial<Record<keyof BrainSelectionState, unknown>>;
  return {
    task: normalizeBucket(record.task),
    mission: normalizeBucket(record.mission),
    session: normalizeBucket(record.session),
  };
}

export function mergeBrainSelection(
  existing: BrainSelectionState,
  updates: Partial<BrainSelectionState> | null | undefined,
): BrainSelectionState {
  const current = normalizeBrainSelection(existing);
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return current;
  }

  const next = { ...current };
  if ("task" in updates) next.task = normalizeBucket(updates.task);
  if ("mission" in updates) next.mission = normalizeBucket(updates.mission);
  if ("session" in updates) next.session = normalizeBucket(updates.session);
  return next;
}
