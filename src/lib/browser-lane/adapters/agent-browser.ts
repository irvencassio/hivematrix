import { createUnavailableBrowserLaneAdapter } from "@/lib/browser-lane/adapter";

export function createAgentBrowserAdapter() {
  return createUnavailableBrowserLaneAdapter("agent_browser");
}
