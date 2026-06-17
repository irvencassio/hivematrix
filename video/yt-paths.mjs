/** Shared filesystem paths for the YouTube tooling (no heavy deps, so the pure
 * ledger/aggregation logic can be imported and unit-tested in isolation). */
import { homedir } from "node:os";
import { join } from "node:path";

export const YT_DIR = join(homedir(), ".hivematrix", "youtube");
export const CREDS = join(YT_DIR, "client_secret.json");
export const TOKEN = join(YT_DIR, "token.json");
export const LEDGER = join(YT_DIR, "uploads.json");
