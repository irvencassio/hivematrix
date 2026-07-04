# model-bench

Head-to-head coding/agentic benchmark for local OpenAI-compatible models.
Built during the 2026-07-04 bake-off that standardized HiveMatrix on
DeepSeek V4 Flash q2-q4 (ds4) with Qwen3.6-35B-A3B (rapid-mlx) as the
lower-memory option. Re-run it whenever a new candidate model drops.

## What it measures

The six tasks probe the failure modes that actually bit HiveMatrix agents,
scored mechanically by executing the generated code (never by eyeballing):

| task | probes | scored by |
|---|---|---|
| T1-curses-recall | stdlib API recall (the `curses.nap` bug class) | py_compile + mypy attr checks |
| T2-ttlcache-pytest | spec-following + correctness | pytest suite |
| T3-node-dupes | cross-language, Node built-ins | `node --check` + fixture run |
| T4-toolchain | two-step agentic tool calling | schema + argument validation |
| T5-bugfix-traceback | repair loop from a traceback | compile + fix verification |
| T6-datetime-precision | tz-aware datetime handling | assert driver |

## Usage

```sh
# against ds4 (DeepSeek)
python3 bench.py --endpoint http://127.0.0.1:8000/v1 --model deepseek-v4-flash \
    --label ds4-flash-q2q4

# against rapid-mlx (Qwen)
python3 bench.py --endpoint http://127.0.0.1:8090/v1 \
    --model mlx-community/Qwen3.6-35B-A3B-8bit --label qwen36-35b-8bit

# compare
python3 report.py ds4-flash-q2q4 qwen36-35b-8bit
```

Needs: `python3` with `mypy` and `pytest` installed, `node` on PATH.
Results accumulate in `results/<label>.json` (`--only T4-toolchain` reruns a
single task and merges). Raw model outputs land in `raw/` for inspection.

Give hybrid-reasoning models `--runs 2` and keep `max_tokens` at 16384 —
thinking-heavy first runs need the headroom (a truncation reads as a false
failure).

## 2026-07-04 results

See `results-2026-07-04/`. Summary: DeepSeek q2-q4 12/12 @ ~30 tok/s,
Qwen3.6-35B-8bit 12/12 @ ~82 tok/s, DeepSeek q2 11.25/12, Qwen3-Coder-Next
10.5/12. Every model hallucinated at least one stdlib API across the session
(`fs/promises` createReadStream was the repeat offender) — which is why the
agent verification gate exists (`src/lib/orchestrator/verification-gate.ts`).
