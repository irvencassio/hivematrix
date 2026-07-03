/**
 * Live Qwen readiness + eval runner.
 *
 * Runs the actual HiveMatrix readiness probe and standing eval suite against
 * the configured local endpoint (LM Studio). This is the Phase 2 gate prover.
 *
 *   npx tsx scripts/qwen-readiness.mts
 *
 * Reads the Qwen profile from ~/.hivematrix/config.json.
 */

import { getQwenProfile } from "../src/lib/config/qwen-profile";
import { probeQwenReadiness } from "../src/lib/local-model/health";
import { runEvalSuite } from "../src/lib/eval/suite";

function line(s = "") { process.stdout.write(s + "\n"); }

async function main() {
  const profile = getQwenProfile();
  if (!profile) {
    line("⊘ No Qwen profile in ~/.hivematrix/config.json");
    line("  Local Qwen readiness skipped: HiveMatrix can run cloud-first before Rapid-MLX is installed.");
    line("  To enable this gate, run: npx tsx scripts/provision-local-engine.mts --apply");
    process.exit(0);
  }

  const { modelId, endpoint, provider, contextLimit } = profile.primary;
  line("HiveMatrix Qwen Readiness Gate");
  line("================================");
  line(`Provider:     ${provider}`);
  line(`Endpoint:     ${endpoint}`);
  line(`Model:        ${modelId}`);
  line(`Context:      ${contextLimit}`);
  line(`Min decode:   ${profile.minDecodeRate} tok/s`);
  line("");

  // --- Readiness probe ---
  line("Running readiness probe (6 checks)...");
  const health = await probeQwenReadiness({
    provider: provider as "mlx" | "vllm" | "ollama" | "lmstudio",
    endpoint,
    modelName: modelId,
    minDecodeRate: profile.minDecodeRate,
    timeoutMs: 60_000,
    toolCallTimeoutMs: profile.probeTimeoutMs,
  });

  const check = (ok: boolean) => (ok ? "✓" : "✗");
  line(`  ${check(health.modelFound)} model listed`);
  line(`  ${check(health.streaming)} streaming round-trip`);
  line(`  ${check(health.toolCalls)} single tool call`);
  line(`  ${check(health.toolChain ?? false)} multi-step tool chain`);
  line(`  ${check(health.thinkSeparation ?? false)} reasoning/think separation`);
  line(`  ${check((health.decodeRateTokPerSec ?? 0) >= profile.minDecodeRate)} decode rate: ${health.decodeRateTokPerSec?.toFixed(1) ?? "?"} tok/s`);
  line("");
  line(`  Readiness: ${health.qwenReady ? "✓ READY" : "✗ NOT READY"}`);
  line(`  ${health.message}`);
  line("");

  if (!health.qwenReady) {
    line("Readiness gate failed — skipping eval suite.");
    process.exit(2);
  }

  // --- Eval suite ---
  line("Running standing eval suite (6 cases)...");
  // Generous budget: reasoning-heavy cases run 60–120s each on a 27B local model.
  const suite = await runEvalSuite(endpoint, modelId, { timeoutMs: 900_000 });
  for (const r of suite.results) {
    const skipped = (r.output as { skipped?: boolean })?.skipped === true;
    const status = skipped ? "⊘ skip" : r.passed ? "✓ pass" : "✗ FAIL";
    line(`  ${status}  ${r.caseId.padEnd(14)} ${r.durationMs}ms${r.error ? "  (" + r.error + ")" : ""}`);
  }
  line("");
  line(`  Eval: ${suite.pass} pass, ${suite.fail} fail, ${suite.skipped} skipped`);
  line(`  ${suite.allPassed ? "✓ EVAL SUITE GREEN" : "✗ EVAL SUITE RED"}`);

  process.exit(suite.allPassed && health.qwenReady ? 0 : 3);
}

main().catch((err) => {
  line(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
