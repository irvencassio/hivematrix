import { ContractValidationError } from "@/lib/central/contracts";

export const BROWSER_LANE_BACKENDS = ["agent_browser", "playwright_mcp", "chrome_devtools_mcp", "codex_computer_use", "browserbase"] as const;
export type BrowserLaneBackend = (typeof BROWSER_LANE_BACKENDS)[number];

export const BROWSER_ACTION_TYPES = ["click", "fill", "type", "upload", "wait", "credential_fill"] as const;
export type BrowserActionType = (typeof BROWSER_ACTION_TYPES)[number];

export interface OpenInput {
  siteId?: string | null;
  url: string;
  profileRef?: string | null;
}

export interface OpenResult {
  ok: boolean;
  pageId?: string;
  error?: string;
}

export interface SnapshotInput {
  pageId?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  state: "authenticated" | "unauthenticated" | "unknown";
  actions: Array<{ ref: string; kind: string; text?: string; risk?: string }>;
  forms: Array<{ ref: string; purpose: string; fields: Array<{ ref: string; kind: string; label?: string }> }>;
  text: string;
}

export interface BrowserAction {
  type: BrowserActionType;
  ref?: string;
  value?: string;
  credentialRef?: string;
}

export interface BrowserActionResult {
  ok: boolean;
  error?: string;
  humanRequired?: "captcha" | "two_factor" | "login" | "unknown";
}

export interface ScreenshotInput {
  pageId?: string;
  path?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface CloseInput {
  pageId?: string;
}

export interface CloseResult {
  ok: boolean;
}

export interface BrowserLaneAdapter {
  open(input: OpenInput): Promise<OpenResult>;
  snapshot(input: SnapshotInput): Promise<PageSnapshot>;
  act(input: BrowserAction): Promise<BrowserActionResult>;
  screenshot(input: ScreenshotInput): Promise<ScreenshotResult>;
  close(input: CloseInput): Promise<CloseResult>;
}

export function normalizeBrowserAction(input: unknown): BrowserAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ContractValidationError("browser action must be an object");
  const record = input as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (!(BROWSER_ACTION_TYPES as readonly string[]).includes(type)) {
    throw new ContractValidationError(`browser action type must be one of: ${BROWSER_ACTION_TYPES.join(", ")}`);
  }
  const ref = typeof record.ref === "string" && record.ref.trim() ? record.ref.trim() : undefined;
  const value = typeof record.value === "string" ? record.value : undefined;
  const credentialRef = typeof record.credentialRef === "string" ? record.credentialRef.trim() : undefined;
  return { type: type as BrowserActionType, ref, value, credentialRef };
}

export function createUnavailableBrowserLaneAdapter(backend: BrowserLaneBackend): BrowserLaneAdapter {
  const error = `Browser Lane backend ${backend} is not wired yet`;
  return {
    async open() {
      return { ok: false, error };
    },
    async snapshot() {
      return { url: "about:blank", title: "Unavailable", state: "unknown", actions: [], forms: [], text: error };
    },
    async act() {
      return { ok: false, error };
    },
    async screenshot() {
      return { ok: false, error };
    },
    async close() {
      return { ok: true };
    },
  };
}
