#!/usr/bin/env node
/**
 * Explicit YouTube authorization entry point for the setup guide.
 *
 * The shared auth module owns the actual OAuth logic and token cache:
 * ~/.hivematrix/youtube/client_secret.json -> ~/.hivematrix/youtube/token.json
 */
import { getAuth, SCOPE_UPLOAD } from "./yt-auth.mjs";
import { TOKEN } from "./yt-paths.mjs";

await getAuth([SCOPE_UPLOAD]);
console.log(`YouTube upload token saved to ${TOKEN}`);

