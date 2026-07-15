/**
 * Filter internal harness status strings from message text before sending.
 * Prevents system/diagnostic messages from reaching end users on SMS/iMessage.
 */

const INTERNAL_STATUS_PATTERNS = [
  // Task/harness status messages
  /^Task (created|queued|processing).*\.?$/im,
  /^Check back in a moment\.?$/im,

  // Common diagnostic/placeholder phrases that should not be user-facing
  /^(Waiting for|Processing|Generating|Fetching|Sending).*\.{1,3}\s*$/im,
  /^[A-Z][a-z]+ (created|added|updated|completed|failed|generated|sent|processed)\s*.*\.?$/im,

  // Harness control flow strings
  /^\s*(next|retry|waiting|deferred|escalated)\s*\.?$/im,
];

/**
 * Check if a message contains only internal status strings (no user content).
 * Returns true if the message should be filtered out entirely.
 */
export function isInternalStatusOnly(text: string): boolean {
  if (!text || !text.trim()) return false;

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l);
  if (lines.length === 0) return false;

  // If all lines match internal patterns, filter it
  return lines.every((line) =>
    INTERNAL_STATUS_PATTERNS.some((pattern) => pattern.test(line))
  );
}

/**
 * Remove internal status strings from message text while preserving user content.
 * Strips out status/diagnostic lines but keeps the actual message body.
 */
export function stripInternalStatus(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // Keep empty lines

    // Check if this line is an internal status message
    return !INTERNAL_STATUS_PATTERNS.some((pattern) => pattern.test(trimmed));
  });

  // Clean up excessive whitespace while preserving intentional formatting
  let result = filtered.join("\n").trim();

  // Remove leading/trailing blank lines
  result = result.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "");

  return result;
}
