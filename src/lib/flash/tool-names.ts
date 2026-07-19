/**
 * The one spelling of a Flash tool the model ever sees.
 *
 * Claude namespaces MCP tools as `mcp__<server>__<tool>`, so every Flash tool
 * reaches the model as `mcp__flash__brain_search`, never `brain_search`. The
 * bare name is an internal detail: the MCP server stores and dispatches on it,
 * and the CLI strips the namespace before the JSON-RPC `tools/call`.
 *
 * This module exists because that distinction was being restated by hand in two
 * places that then disagreed with each other:
 *
 *  - the capability doctrine in context.ts wrote bare names in prose, so the
 *    model dutifully emitted `brain_search` and got "No such tool available"
 *    from the CLI — before any HiveMatrix code ran, so nothing could recover it;
 *  - loop.ts compared a CLI-supplied tool name against the bare
 *    `"escalate_to_task"`, a comparison that cannot be true on a real stream, so
 *    the escalation event never fired in production.
 *
 * Anything that names a tool to the model, or compares against a name the CLI
 * gave us, goes through here so the two can't drift apart again.
 */

/** MCP server name → Claude namespaces its tools as `mcp__flash__<tool>`. */
export const FLASH_MCP_SERVER_NAME = "flash";

const PREFIX = `mcp__${FLASH_MCP_SERVER_NAME}__`;

/** Bare tool name → the namespaced name the model is actually offered. */
export function flashToolName(bare: string): string {
  return bare.startsWith(PREFIX) ? bare : `${PREFIX}${bare}`;
}

/**
 * Namespaced name → bare name. Use before comparing against a tool name that
 * came from the CLI stream, which always carries the namespace.
 * Idempotent, so it is safe on a name that is already bare.
 */
export function bareFlashToolName(name: string): string {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

/** True if `name` refers to `bare`, whichever spelling it arrived in. */
export function isFlashTool(name: string, bare: string): boolean {
  return bareFlashToolName(name) === bare;
}
