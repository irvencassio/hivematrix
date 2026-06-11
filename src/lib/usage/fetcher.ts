// Usage fetcher stub — cached Claude/Codex usage data for scheduler throttling.
// Phase 1 will wire this to the actual usage API.

export interface UsageWindow {
  utilization: number;
  resetsAt: string | undefined;
}

export interface ProfileUsage {
  profile: string;
  accountName: string;
  accountEmail: string;
  planType: string;
  provider?: string;
  fetchedAt?: string;
  fiveHour?: UsageWindow | null;
  sevenDay?: UsageWindow | null;
  sevenDayOpus?: UsageWindow | null;
  sevenDaySonnet?: UsageWindow | null;
  extraUsage?: UsageWindow | null;
}

export interface UsageData {
  fetchedAt: string;
  profiles: ProfileUsage[];
}

export function readCachedUsage(): UsageData | null {
  return null;
}
