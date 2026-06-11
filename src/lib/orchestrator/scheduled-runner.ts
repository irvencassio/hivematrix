// Scheduled-runner: advances the directive run engine each scheduler tick.
// Replaces the Hive 1 scheduled-tasks/mission stub — directives are the
// HiveMatrix long-horizon primitive (Q6).
import { directiveTick } from "./directive-engine";

export async function scheduledRunnerTick(): Promise<void> {
  await directiveTick();
}
