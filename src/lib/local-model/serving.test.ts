import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createServer, type Server } from "node:http";
import {
  portFromEndpoint, resolveServeCommand, decideServeTick,
  startLocalServingSupervisor, stopLocalServingSupervisor, getServingStatus, isServerUp,
  waitForServerReady,
} from "./serving";
import { type QwenProfile, DEFAULT_SAMPLING } from "@/lib/config/qwen-profile";

// Fixed test ports collide when two checkouts/sessions run the suite at once
// (EADDRINUSE flakes). Bind :0, take the kernel-assigned port, release it —
// each run gets its own port and a just-freed port is reliably closed for the
// negative probes too.
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const profile = (over: Partial<QwenProfile["primary"]> & { location?: QwenProfile["location"] } = {}): QwenProfile => ({
  location: over.location ?? "local",
  primary: {
    modelId: over.modelId ?? "Qwen3.6-27B", endpoint: over.endpoint ?? "http://127.0.0.1:8080",
    provider: over.provider ?? "mlx", contextLimit: over.contextLimit ?? 131072,
    maxOutputTokens: over.maxOutputTokens ?? 16384,
  },
  secondary: null, thinkingEnabled: true, minDecodeRate: 15, probeTimeoutMs: 60000,
  sampling: DEFAULT_SAMPLING,
});

test("portFromEndpoint parses the port (default 8080)", () => {
  assert.equal(portFromEndpoint("http://127.0.0.1:1234/v1"), 1234);
  assert.equal(portFromEndpoint("http://localhost"), 8080);
});

test("resolveServeCommand maps providers and skips remote/vllm", () => {
  assert.deepEqual(resolveServeCommand(profile({ provider: "mlx", modelId: "M", endpoint: "http://127.0.0.1:8080" }), null),
    { cmd: "mlx_lm.server", args: ["--model", "M", "--host", "127.0.0.1", "--port", "8080"] });
  assert.equal(resolveServeCommand(profile({ provider: "lmstudio", endpoint: "http://127.0.0.1:1234" }), null)?.cmd, "lms");
  assert.equal(resolveServeCommand(profile({ provider: "ollama" }), null)?.cmd, "ollama");
  assert.equal(resolveServeCommand(profile({ provider: "vllm" }), null), null);
  assert.equal(resolveServeCommand(profile({ location: "lan" }), null), null); // remote: unmanaged
});

test("resolveServeCommand launches Rapid-MLX tier aliases with rapid-mlx", () => {
  const home = mkdtempSync(join(tmpdir(), "hm-rapid-serve-"));
  const origHome = process.env.HOME;
  const fakeRapid = join(home, "bin", "rapid-mlx");
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(fakeRapid, "#!/bin/sh\n");
  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
    localEngine: {
      engine: "rapid-mlx",
      binary: fakeRapid,
      tiers: [{ key: "fast", alias: "qwen3.6-35b-4bit", port: 8000, reasoning: false }],
    },
  }));
  process.env.HOME = home;

  try {
    assert.deepEqual(resolveServeCommand(profile({
      provider: "mlx",
      modelId: "qwen3.6-35b-4bit",
      endpoint: "http://127.0.0.1:8000/v1",
    }), null), {
      cmd: fakeRapid,
      args: ["serve", "qwen3.6-35b-4bit", "--host", "127.0.0.1", "--port", "8000", "--no-thinking", "--kv-cache-dtype", "int4"],
    });
  } finally {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveServeCommand honors an override array", () => {
  assert.deepEqual(resolveServeCommand(profile(), ["node", "x.js", "5"]), { cmd: "node", args: ["x.js", "5"] });
});

test("decideServeTick covers every branch", () => {
  const base = { location: "local" as const, hasCommand: true, healthy: false, childAlive: false, msSinceLastStart: 99999 };
  assert.equal(decideServeTick({ ...base, location: "lan" }).action, "unmanaged");
  assert.equal(decideServeTick({ ...base, hasCommand: false }).action, "unmanaged");
  assert.equal(decideServeTick({ ...base, healthy: true }).action, "healthy");
  assert.equal(decideServeTick({ ...base, childAlive: true }).action, "starting");
  assert.equal(decideServeTick({ ...base, msSinceLastStart: 10, throttleMs: 1000 }).action, "throttled");
  assert.equal(decideServeTick(base).action, "spawn");
});

test("decideServeTick: enabled omitted behaves exactly as before (backward compatible)", () => {
  const base = { location: "local" as const, hasCommand: true, healthy: true, childAlive: false, msSinceLastStart: 99999 };
  assert.equal(decideServeTick(base).action, "healthy");
});

test("decideServeTick: disabled wins over every other branch, including an already-healthy server", () => {
  const disabled = { location: "local" as const, hasCommand: true, healthy: false, childAlive: false, msSinceLastStart: 99999, enabled: false };
  assert.equal(decideServeTick({ ...disabled, healthy: true }).action, "disabled");
  assert.equal(decideServeTick({ ...disabled, childAlive: true }).action, "disabled");
  assert.equal(decideServeTick({ ...disabled, location: "lan" }).action, "disabled");
});

test("decideServeTick: enabled true behaves identically to enabled omitted", () => {
  const base = { location: "local" as const, hasCommand: true, healthy: false, childAlive: false, msSinceLastStart: 99999, enabled: true };
  assert.equal(decideServeTick(base).action, "spawn");
});

test("waitForServerReady returns false quickly when nothing is listening", async () => {
  // Just-freed port → never comes up; bounded window so the test is fast.
  const port = await freePort();
  const ready = await waitForServerReady(`http://127.0.0.1:${port}`, { timeoutMs: 600, intervalMs: 150, probeTimeoutMs: 200 });
  assert.equal(ready, false);
});

test("waitForServerReady resolves true once a server starts mid-wait", { timeout: 10_000 }, async () => {
  const PORT = await freePort();
  let server: Server | null = null;
  // Start the server ~400ms in, after the first failed probe.
  const startTimer = setTimeout(() => {
    server = createServer((_req, res) => { res.writeHead(200); res.end("ok"); });
    server.listen(PORT, "127.0.0.1");
  }, 400);
  try {
    const ready = await waitForServerReady(`http://127.0.0.1:${PORT}`, { timeoutMs: 5_000, intervalMs: 150, probeTimeoutMs: 300 });
    assert.equal(ready, true);
  } finally {
    clearTimeout(startTimer);
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  }
});

test("waitForServerReady bails out when the abort signal fires", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  const port = await freePort();
  const ready = await waitForServerReady(`http://127.0.0.1:${port}`, { timeoutMs: 5_000, intervalMs: 150, probeTimeoutMs: 200, signal: ac.signal });
  assert.equal(ready, false);
});

test("supervisor launches the local server, and relaunches it after a crash", { timeout: 25_000 }, async () => {
  const PORT = await freePort();
  const home = mkdtempSync(join(tmpdir(), "mb-serving-"));
  const origHome = process.env.HOME;
  // Fake "model server": replies 200 to /v1/models so isServerUp() passes.
  const serverJs = join(home, "fake-server.js");
  writeFileSync(serverJs, `
    const http = require("http");
    http.createServer((_req, res) => { res.writeHead(200); res.end("ok"); }).listen(Number(process.argv[2]), "127.0.0.1");
  `);
  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
    qwen: {
      location: "local",
      primary: { modelId: "fake", endpoint: `http://127.0.0.1:${PORT}`, provider: "mlx", contextLimit: 1000 },
      serveCommand: ["node", serverJs, String(PORT)],
    },
    // Explicit — must not depend on this host having a real rapid-mlx binary
    // (the tick's isLocalEngineEnabled() default-detect probe would otherwise
    // fall through to a real PATH/capability check when the key is absent).
    localEngine: { enabled: true },
  }));
  process.env.HOME = home;

  const waitFor = async (pred: () => boolean | Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  };

  try {
    startLocalServingSupervisor({ intervalMs: 300, throttleMs: 200 });

    // 1) It should launch the server and report healthy.
    assert.ok(await waitFor(() => isServerUp(`http://127.0.0.1:${PORT}`), 10_000), "server should come up");
    const restartsBefore = getServingStatus().restarts;
    const pid = getServingStatus().pid;
    assert.ok(pid, "should have a child pid");

    // 2) Kill it — the supervisor must relaunch within the window.
    process.kill(pid!, "SIGKILL");
    assert.ok(await waitFor(() => isServerUp(`http://127.0.0.1:${PORT}`), 10_000), "server should be relaunched");
    assert.ok(getServingStatus().restarts > restartsBefore, "restart count should increase");
  } finally {
    const finalPid = getServingStatus().pid;
    stopLocalServingSupervisor();
    if (finalPid) { try { process.kill(finalPid, "SIGKILL"); } catch { /* gone */ } }
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("supervisor stops the managed server when the local engine is toggled off, and does not relaunch it", { timeout: 25_000 }, async () => {
  const PORT = await freePort();
  const home = mkdtempSync(join(tmpdir(), "mb-serving-toggle-"));
  const origHome = process.env.HOME;
  const serverJs = join(home, "fake-server.js");
  writeFileSync(serverJs, `
    const http = require("http");
    http.createServer((_req, res) => { res.writeHead(200); res.end("ok"); }).listen(Number(process.argv[2]), "127.0.0.1");
  `);
  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  const configPath = join(home, ".hivematrix", "config.json");
  const configFor = (enabled: boolean) => JSON.stringify({
    qwen: {
      location: "local",
      primary: { modelId: "fake", endpoint: `http://127.0.0.1:${PORT}`, provider: "mlx", contextLimit: 1000 },
      serveCommand: ["node", serverJs, String(PORT)],
    },
    localEngine: { enabled },
  });
  writeFileSync(configPath, configFor(true));
  process.env.HOME = home;

  const waitFor = async (pred: () => boolean | Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  };

  try {
    startLocalServingSupervisor({ intervalMs: 300, throttleMs: 200 });

    assert.ok(await waitFor(() => isServerUp(`http://127.0.0.1:${PORT}`), 10_000), "server should come up while enabled");

    // Toggle off — the next tick must kill the child and stop reporting healthy.
    writeFileSync(configPath, configFor(false));
    assert.ok(await waitFor(async () => !(await isServerUp(`http://127.0.0.1:${PORT}`)), 10_000), "server should be stopped once disabled");
    assert.equal(getServingStatus().pid, null, "no managed pid once disabled");
    assert.equal(getServingStatus().enabled, false);

    // Give it another full interval window to prove it does NOT relaunch while disabled.
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await isServerUp(`http://127.0.0.1:${PORT}`), false, "must not relaunch while disabled");
  } finally {
    const finalPid = getServingStatus().pid;
    stopLocalServingSupervisor();
    if (finalPid) { try { process.kill(finalPid, "SIGKILL"); } catch { /* gone */ } }
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  }
});
