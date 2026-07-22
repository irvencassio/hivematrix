// Shared jsdom harness for driving the operator console in tests.
//
// The Tools/skill-panel regressions of 0.1.237–0.1.243 shared one shape: a
// control is rendered from one input, but its handler reads a SEPARATE piece of
// module state the entry point never populated — so the click hits a silent
// `if (!x) return` and nothing happens. Source grep can't see that wiring; both
// halves are individually correct. The only way to catch it is to MOUNT the real
// console, stub the routes its buttons call, and DRIVE each control the operator's
// way (a real click on the real element), asserting an observable effect.
//
// This lives in its own module (not inline in console.test.ts) so every future
// dead-control audit reuses ONE driver instead of re-deriving it. It is test-only:
// it pulls in jsdom (a devDependency) and is imported solely from *.test.ts, so it
// never reaches the daemon bundle.

import { JSDOM, VirtualConsole } from "jsdom";
import { CONSOLE_HTML } from "./console";

export type FetchCall = { method: string; path: string; body: string | null };

/**
 * Canned daemon responses for the routes the console's controls call. Extend
 * this as new controls (and thus new routes) come under test — keep it the one
 * place the harness knows about the backend.
 */
export function consoleReply(path: string): unknown {
  if (path.startsWith("/capabilities")) return { groups: [
    { kind: "skill-library", tools: [{ name: "weekly-ai-roundup", description: "d", kind: "skill" }] },
    { kind: "skill-tool", tools: [{ name: "roundup", skillName: "weekly-ai-roundup", description: "d" }] },
    { kind: "local-command", tools: [{ name: "storelookup", description: "d" }] },
    { kind: "native", tools: [{ name: "brain_read", description: "d", enabled: true }] },
  ] };
  if (path === "/skills") return { skills: [{ name: "weekly-ai-roundup", description: "d", kind: "skill", hasInput: true, params: ["topic"], scope: "team", signed: true, trusted: false }] };
  if (path === "/commands") return { commands: [{ invokeName: "storelookup", displayName: "storelookup", description: "d", kind: "command", options: { source: "hint", options: [{ name: "--json", kind: "flag" }], positionals: [] } }] };
  if (path === "/projects") return { projects: [{ name: "hivematrix", path: "/repo/hivematrix" }, { name: "other", path: "/repo/other" }] };
  if (path === "/models") return { available: [], theme: "system", defaultModel: "" };
  if (path.startsWith("/integrate/branches")) return { base: "main", branches: [{ branch: "hive/task-1", ahead: 2, behind: 0, ffOk: true }] };
  if (path.startsWith("/skills/") && path.endsWith("/run")) return { task: { _id: "t1" } };
  if (path.endsWith("/publish")) return { ok: true, pushed: true, signedBy: "me" };
  if (path.endsWith("/trust")) return { ok: true };
  if (path.startsWith("/skills/")) return { markdown: "# skill md" };
  if (path === "/commands/run") return { task: { _id: "t2" } };
  if (path === "/tasks" || path === "/directives") return [];
  if (path === "/approvals/pending") return { approvals: [] };
  if (path === "/lanes") return { lanes: [] };
  return {};
}

export type Mounted = {
  window: any; document: any; calls: FetchCall[];
  tick: (n?: number) => Promise<void>;
  click: (el: any) => void;
  acceptDialog: () => boolean;
  close: () => void;
};

/**
 * Mount the real console in jsdom with fetch/EventSource/clipboard stubbed, run
 * its init, and hand back the window plus helpers to drive it:
 *  - calls:        every fetch (and clipboard write) the page made, in order
 *  - tick(n):      flush n microtasks + a macrotask so handlers settle
 *  - click(el):    a real bubbling MouseEvent on a real element
 *  - acceptDialog: click the confirm dialog's OK when it's open (returns whether it was)
 */
export async function mountConsole(): Promise<Mounted> {
  const calls: FetchCall[] = [];
  const vc = new VirtualConsole(); // swallow init-time console noise, not test assertions
  const dom = new JSDOM(CONSOLE_HTML, {
    runScripts: "dangerously",
    url: "https://localhost/",
    virtualConsole: vc,
    beforeParse(w: any) {
      w.fetch = (path: string, opts: any) => {
        calls.push({ method: (opts && opts.method) || "GET", path: String(path), body: (opts && opts.body) || null });
        return Promise.resolve({ status: 200, json: () => Promise.resolve(consoleReply(String(path))), text: () => Promise.resolve("") });
      };
      w.EventSource = class { close() {} addEventListener() {} };
      w.scrollTo = () => {};
      w.setInterval = () => 0;       // no background polling under test
      w.setTimeout = (_fn: any) => 0; // no deferred re-entrancy
      Object.defineProperty(w.navigator, "clipboard", {
        value: { writeText: (t: string) => { calls.push({ method: "CLIP", path: "clipboard", body: t }); return Promise.resolve(); } },
        configurable: true,
      });
    },
  });
  const w = dom.window, doc = w.document;
  const tick = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };
  const click = (el: any) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const acceptDialog = () => {
    const ok = doc.getElementById("dialogOk"), ov = doc.getElementById("dialogOverlay");
    if (ok && ov && ov.classList.contains("open")) { click(ok); return true; }
    return false;
  };
  await tick(10); // let init (refresh/loadModels/loadProjects) settle
  return { window: w, document: doc, calls, tick, click, acceptDialog, close: () => w.close() };
}
