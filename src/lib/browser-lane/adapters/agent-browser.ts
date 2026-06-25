/**
 * Browser Lane — agent_browser adapter (read-only MVP).
 *
 * A deliberately conservative backend: it fetches a URL with no cookies or
 * credentials and builds a deterministic snapshot (title, text, forms, links,
 * buttons) from the static HTML. This is enough to drive readiness probes for
 * public/readable pages honestly, and it CANNOT masquerade as an authenticated
 * session — a cookieless fetch can never prove auth, so `state` is never
 * "authenticated". Authenticated/interactive work stays on the Codex Computer
 * Use / Desktop-fallback execution paths (unchanged).
 *
 * No new dependencies: a small, deterministic HTML extractor. Trade-off: no JS
 * rendering — a client-rendered SPA yields a thin snapshot (→ probe_failed/unknown),
 * never a false green. Swap in Playwright behind BrowserLaneAdapter later if needed.
 *
 * Never returns cookies, storage, headers, input values, or credential material.
 * Secret-looking text is redacted.
 */

import type {
  BrowserAction,
  BrowserActionResult,
  BrowserLaneAdapter,
  CloseInput,
  CloseResult,
  OpenInput,
  OpenResult,
  PageSnapshot,
  ScreenshotInput,
  ScreenshotResult,
  SnapshotInput,
} from "@/lib/browser-lane/adapter";

export interface FetchedPage {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  html?: string;
  error?: string;
}

export type FetchPage = (url: string) => Promise<FetchedPage>;

const MAX_TEXT = 20_000;
const MAX_ACTIONS = 60;
const MAX_FORMS = 20;
const FETCH_TIMEOUT_MS = 15_000;

/** Default page fetch: GET, follow redirects, no cookies/credentials, static UA. */
async function defaultFetchPage(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      // Node fetch sends no cookies by default; we never attach credentials.
      headers: { "User-Agent": "HiveMatrix-BrowserLane/1.0 (+readiness probe; read-only)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, html };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── HTML helpers (deterministic, regex-based; MVP scope) ──────────────────────

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    });
}

/** Redact obvious secrets from text before it ever enters a snapshot. */
export function redactSnapshotText(input: string): string {
  if (!input) return input;
  let s = input;
  s = s.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  s = s.replace(
    /\b((?:set-)?cookie|password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|session)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    "$1=[redacted]",
  );
  return s;
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

function extractText(htmlNoNoise: string): string {
  const stripped = htmlNoNoise.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped).replace(/\s+/g, " ").trim();
  return redactSnapshotText(text).slice(0, MAX_TEXT);
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
}

interface SnapshotField { ref: string; kind: string; label?: string }

function extractForms(htmlNoNoise: string): PageSnapshot["forms"] {
  // Map <label for="id">text</label> → id, for field labelling.
  const labelFor = new Map<string, string>();
  for (const m of htmlNoNoise.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const forId = attr(`<label ${m[1]}>`, "for");
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (forId && text) labelFor.set(forId, text);
  }

  const forms: PageSnapshot["forms"] = [];
  for (const fm of htmlNoNoise.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    if (forms.length >= MAX_FORMS) break;
    const body = fm[2];
    const fields: SnapshotField[] = [];
    let idx = 0;
    const pushField = (tag: string, defaultKind: string) => {
      idx += 1;
      const type = attr(tag, "type")?.toLowerCase() ?? defaultKind;
      const id = attr(tag, "id");
      const name = attr(tag, "name");
      const ref = id || name || `field_${idx}`;
      const label = (id && labelFor.get(id)) || attr(tag, "aria-label") || attr(tag, "placeholder") || name || undefined;
      fields.push({ ref, kind: type, ...(label ? { label } : {}) });
    };
    for (const im of body.matchAll(/<input\b[^>]*>/gi)) pushField(im[0], "text");
    for (const sm of body.matchAll(/<select\b[^>]*>/gi)) pushField(sm[0], "select");
    for (const tm of body.matchAll(/<textarea\b[^>]*>/gi)) pushField(tm[0], "textarea");

    const hasPassword = fields.some((f) => f.kind === "password");
    const looksSearch = fields.some((f) => /search/i.test(`${f.ref} ${f.label ?? ""}`));
    const purpose = hasPassword ? "login" : looksSearch ? "search" : "form";
    forms.push({ ref: attr(`<form ${fm[1]}>`, "id") || attr(`<form ${fm[1]}>`, "name") || `form_${forms.length + 1}`, purpose, fields });
  }
  return forms;
}

function extractActions(htmlNoNoise: string): PageSnapshot["actions"] {
  const actions: PageSnapshot["actions"] = [];
  const add = (kind: string, text: string, ref: string) => {
    if (actions.length >= MAX_ACTIONS) return;
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    actions.push({ ref, kind, text: t.slice(0, 200) });
  };
  let i = 0;
  for (const m of htmlNoNoise.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    add("link", decodeEntities(m[1].replace(/<[^>]+>/g, " ")), `link_${++i}`);
  }
  let b = 0;
  for (const m of htmlNoNoise.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    add("button", decodeEntities(m[1].replace(/<[^>]+>/g, " ")), `button_${++b}`);
  }
  for (const m of htmlNoNoise.matchAll(/<input\b[^>]*>/gi)) {
    const type = attr(m[0], "type")?.toLowerCase();
    if (type === "submit" || type === "button") add("button", attr(m[0], "value") ?? type, `button_${++b}`);
  }
  return actions;
}

/** Pure: build a PageSnapshot from a URL + its static HTML. Deterministic. */
export function buildAgentBrowserSnapshot(url: string, html: string): PageSnapshot {
  const noNoise = stripNoise(html ?? "");
  const forms = extractForms(noNoise);
  const hasPassword = forms.some((f) => f.fields.some((field) => field.kind === "password"));
  // Cookieless fetch can never prove a session: a login wall → unauthenticated,
  // otherwise unknown. Never "authenticated".
  const state: PageSnapshot["state"] = hasPassword ? "unauthenticated" : "unknown";
  return {
    url,
    title: extractTitle(html ?? ""),
    state,
    actions: extractActions(noNoise),
    forms,
    text: extractText(noNoise),
  };
}

const EMPTY_SNAPSHOT: PageSnapshot = { url: "about:blank", title: "", state: "unknown", actions: [], forms: [], text: "No page is open." };

export function createAgentBrowserAdapter(opts: { fetchPage?: FetchPage } = {}): BrowserLaneAdapter {
  const fetchPage = opts.fetchPage ?? defaultFetchPage;
  const pages = new Map<string, { url: string; html: string }>();
  let counter = 0;

  return {
    async open(input: OpenInput): Promise<OpenResult> {
      let target: URL;
      try {
        target = new URL(input.url);
      } catch {
        return { ok: false, error: `invalid url: ${input.url}` };
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return { ok: false, error: `agent_browser only supports http(s) urls (got ${target.protocol})` };
      }
      const fetched = await fetchPage(input.url);
      if (!fetched.ok || typeof fetched.html !== "string") {
        return { ok: false, error: fetched.error ?? `fetch failed (HTTP ${fetched.status ?? "?"})` };
      }
      const pageId = `agent-${++counter}`;
      pages.set(pageId, { url: fetched.finalUrl ?? input.url, html: fetched.html });
      return { ok: true, pageId };
    },

    async snapshot(input: SnapshotInput): Promise<PageSnapshot> {
      const page = input.pageId ? pages.get(input.pageId) : [...pages.values()].at(-1);
      if (!page) return EMPTY_SNAPSHOT;
      return buildAgentBrowserSnapshot(page.url, page.html);
    },

    async act(input: BrowserAction): Promise<BrowserActionResult> {
      // Read-only MVP: no interaction. credential_fill is explicitly unsupported —
      // there is no Keychain-backed fill yet, and we never bypass auth/CAPTCHA/2FA.
      if (input.type === "credential_fill") {
        return { ok: false, error: "credential_fill is not supported by the read-only agent_browser MVP" };
      }
      return { ok: false, error: `agent_browser MVP is read-only; "${input.type}" actions are not supported` };
    },

    async screenshot(_input: ScreenshotInput): Promise<ScreenshotResult> {
      return { ok: false, error: "agent_browser MVP does not capture screenshots" };
    },

    async close(input: CloseInput): Promise<CloseResult> {
      if (input.pageId) pages.delete(input.pageId);
      return { ok: true };
    },
  };
}
