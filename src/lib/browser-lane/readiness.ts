import {
  normalizeBrowserReadinessState,
  normalizeBrowserSite,
  normalizeReadinessProbe,
  type BrowserReadinessState,
  type BrowserSite,
  type ReadinessAssertion,
  type ReadinessProbe,
} from "./contracts";
import type { BrowserActionResult, BrowserLaneAdapter, PageSnapshot } from "./adapter";

export interface BrowserReadinessTraceEvent {
  eventType: string;
  siteId: string;
  probeId: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface BrowserReadinessTraceSink {
  record(event: BrowserReadinessTraceEvent): void | Promise<void>;
}

export interface BrowserReadinessRunInput {
  site: unknown;
  probe: unknown;
  adapter: BrowserLaneAdapter;
  trace?: BrowserReadinessTraceSink;
}

export interface BrowserReadinessRunResult {
  site: BrowserSite;
  probe: ReadinessProbe;
  state: BrowserReadinessState;
  snapshot: PageSnapshot | null;
  failedAssertions: ReadinessAssertion[];
  humanRequired?: BrowserActionResult["humanRequired"];
  error?: string;
}

function trace(input: {
  sink?: BrowserReadinessTraceSink;
  site: BrowserSite;
  probe: ReadinessProbe;
  eventType: string;
  message: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  return Promise.resolve(input.sink?.record({
    eventType: input.eventType,
    siteId: input.site.id,
    probeId: input.probe.id,
    message: input.message,
    data: input.data,
  }));
}

function detectHumanRequirement(snapshot: PageSnapshot): BrowserActionResult["humanRequired"] | undefined {
  const text = `${snapshot.title}\n${snapshot.text}`.toLowerCase();
  if (/\b(captcha|recaptcha|hcaptcha|verify you are human)\b/.test(text)) return "captcha";
  if (/\b(two[- ]factor|2fa|authenticator|verification code|enter the code)\b/.test(text)) return "two_factor";
  if (snapshot.state === "unauthenticated" && /\b(sign in|log in|login|password)\b/.test(text)) return "login";
  return undefined;
}

function assertionPasses(assertion: ReadinessAssertion, snapshot: PageSnapshot): boolean {
  const needle = assertion.value.toLowerCase();
  switch (assertion.kind) {
    case "text":
    case "account_text":
      return snapshot.text.toLowerCase().includes(needle);
    case "selector":
      return selectorAssertionPasses(needle, snapshot);
    case "visual":
      return false;
    case "url_contains":
      return snapshot.url.toLowerCase().includes(needle);
  }
}

function selectorAssertionPasses(needle: string, snapshot: PageSnapshot): boolean {
  const haystack: string[] = [];
  for (const action of snapshot.actions) {
    haystack.push(action.ref, action.kind, action.text ?? "", action.risk ?? "");
  }
  for (const form of snapshot.forms) {
    haystack.push(form.ref, form.purpose);
    for (const field of form.fields) {
      haystack.push(field.ref, field.kind, field.label ?? "");
    }
  }
  return haystack.some((value) => value.toLowerCase() === needle || value.toLowerCase().includes(needle));
}

export async function runBrowserReadinessProbe(input: BrowserReadinessRunInput): Promise<BrowserReadinessRunResult> {
  const site = normalizeBrowserSite(input.site);
  const probe = normalizeReadinessProbe(input.probe);
  await trace({ sink: input.trace, site, probe, eventType: "probe.open", message: `Opening ${probe.url}` });

  const open = await input.adapter.open({ siteId: site.id, url: probe.url, profileRef: site.profileRef });
  if (!open.ok) {
    await trace({ sink: input.trace, site, probe, eventType: "probe.open_failed", message: open.error ?? "open failed" });
    return { site, probe, state: normalizeBrowserReadinessState("blocked"), snapshot: null, failedAssertions: [], error: open.error };
  }

  try {
    const snapshot = await input.adapter.snapshot({ pageId: open.pageId });
    await trace({
      sink: input.trace,
      site,
      probe,
      eventType: "probe.snapshot",
      message: `Snapshot ${snapshot.title || snapshot.url}`,
      // Safe snapshot metadata only — never page text, field values, or secrets.
      data: {
        url: snapshot.url,
        state: snapshot.state,
        title: snapshot.title,
        formCount: snapshot.forms.length,
        actionCount: snapshot.actions.length,
      },
    });

    const humanRequired = detectHumanRequirement(snapshot);
    if (humanRequired) {
      await trace({
        sink: input.trace,
        site,
        probe,
        eventType: "probe.human_required",
        message: `Human authentication step required: ${humanRequired}`,
      });
      return {
        site,
        probe,
        state: normalizeBrowserReadinessState("human_required"),
        snapshot,
        failedAssertions: [],
        humanRequired,
      };
    }

    const failedAssertions = probe.assertions.filter((assertion) => !assertion.optional && !assertionPasses(assertion, snapshot));
    await trace({
      sink: input.trace,
      site,
      probe,
      eventType: "probe.assertions",
      message: failedAssertions.length ? `${failedAssertions.length} assertion(s) failed` : "All assertions passed",
      data: { failedAssertions: failedAssertions.map((assertion) => assertion.value) },
    });

    return {
      site,
      probe,
      state: normalizeBrowserReadinessState(failedAssertions.length ? "probe_failed" : "ready"),
      snapshot,
      failedAssertions,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await trace({ sink: input.trace, site, probe, eventType: "probe.error", message: error });
    return { site, probe, state: normalizeBrowserReadinessState("probe_failed"), snapshot: null, failedAssertions: [], error };
  } finally {
    await input.adapter.close({ pageId: open.pageId });
    await trace({ sink: input.trace, site, probe, eventType: "probe.close", message: "Probe closed" });
  }
}
