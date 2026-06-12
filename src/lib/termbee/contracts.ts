/**
 * TermBee contracts — pure helpers for the persistent terminal-session lane.
 *
 * Sessions are real long-lived shells (no node-pty / tmux dependency); commands
 * are bracketed by a unique completion marker so we can read a command's full
 * combined output + exit code back off the shared stdout stream.
 */

export interface TermSessionInfo {
  id: string;
  cwd: string;
  alive: boolean;
  createdAt: string;
}

export interface TermRunResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** A per-command marker that won't collide with normal output. */
export function makeMarker(nonce: string): string {
  return `__TERMBEE_DONE_${nonce}__`;
}

/**
 * The line written to the shell to run `cmd` and emit a completion marker.
 * The command runs in a BRACE GROUP (current shell, not a subshell) with stderr
 * merged to stdout — so cd/export persist across commands while we still capture
 * combined output; the marker carries the exit code.
 */
export function buildCommandPayload(cmd: string, marker: string): string {
  return `{\n${cmd}\n} 2>&1\necho "${marker}:$?"\n`;
}

/**
 * Given accumulated shell stdout and the marker, return the command output (up
 * to the marker) + exit code, or null if the marker hasn't arrived yet.
 */
export function extractResult(buffer: string, marker: string): { output: string; exitCode: number } | null {
  const re = new RegExp(`${marker}:(-?\\d+)\\r?\\n?`);
  const m = buffer.match(re);
  if (!m || m.index === undefined) return null;
  return { output: buffer.slice(0, m.index), exitCode: parseInt(m[1], 10) };
}
