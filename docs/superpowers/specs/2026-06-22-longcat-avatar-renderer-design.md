# LongCat Avatar Renderer Design

## Status

Brainstorming draft, pending user approval. Do not implement from this document yet.

## Context

HiveMatrix already has a local-first video factory:

- `video/make.mjs` renders local narrated videos with Remotion and ffmpeg.
- `voice-sidecar` produces local cloned-voice narration and caption timing.
- `video/make-avatar.mjs` and `video/heygen.mjs` provide the current optional HeyGen avatar path.
- `src/lib/video/factory.ts` is the daemon bridge for the local video factory.
- `src/daemon/server.ts` exposes `/video/make`.

The earlier handoff assumed LongCat might run on a different render machine. The target has now been corrected: LongCat should be evaluated on this MacBook Pro.

Local machine facts measured on 2026-06-22:

- MacBook Pro `Mac17,6`
- Apple M5 Max
- 18 CPU cores
- 40 GPU cores
- 128 GB unified memory
- macOS 26.5.1
- 636 GB free disk
- Node 26.3.0, npm 11.16.0
- FFmpeg 8.1.1 with VideoToolbox
- Existing Hugging Face cache: 86 GB
- No cached LongCat weights found

Current repo verification before any implementation:

- `npm run typecheck` passed.
- `npm test` passed, 790 tests.
- `node scripts/scope-wall.mjs` passed, 0 violations.

## Upstream Findings

Primary sources checked:

- https://github.com/meituan-longcat/LongCat-Video
- https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5
- https://huggingface.co/mlx-community/LongCat-Video-Avatar-1.5-bf16
- https://arxiv.org/abs/2605.26486

Official Meituan LongCat 1.5 examples are still CUDA/PyTorch-oriented. The avatar 1.5 examples use:

- `torchrun --nproc_per_node=2`
- `--context_parallel_size=2`
- `--model_type avatar-v1.5`
- `--use_distill`
- `--use_int8`

The official Hugging Face card says avatar v1.5 uses Whisper-large-v3 for better lip sync, `--use_distill` is required for avatar v1.5, and `--use_int8` is the supported INT8 reduced-VRAM path for v1.5.

Important new option: there is now an MLX community LongCat Avatar 1.5 port for Apple Silicon. Its model card lists:

- Apple Silicon M-series target.
- 64 GB or more unified memory recommended for 480p.
- `bf16-dmd-merged` baseline around 43 GB on disk.
- `q8-dmd-merged` around 31 GB on disk.
- `q4-dmd-merged` around 24 GB on disk.
- A reported Apple M5 Max 128 GB benchmark of roughly 105 seconds for 29 frames at 256 x 432 with the 8-step DMD path.

## Local Benchmark Probes

No large model weights were downloaded for this draft.

A temporary MLX probe venv was created at `/tmp/hivematrix-mlx-probe`. It installed `mlx` and confirmed:

- MLX version: 0.31.2
- Default device: `Device(gpu, 0)`

Synthetic FP16 matmul benchmark:

| Size | Median | Approx TFLOP/s |
| --- | ---: | ---: |
| 4096 x 4096 | 0.0027 s | 51.8 |
| 8192 x 8192 | 0.0209 s | 52.5 |
| 12288 x 12288 | 0.0770 s | 48.2 |

This does not prove LongCat performance. It only proves that MLX GPU execution is healthy enough to justify a controlled LongCat trial.

## Approaches

### Approach A: Keep HeyGen Primary, Add LongCat As Research

Keep `make-avatar.mjs` and HeyGen as the only production avatar renderer. Separately create a local LongCat proof harness outside the production video route.

Pros:

- Lowest production risk.
- No `/video/make` routing changes yet.
- Lets us learn real MLX performance before committing to architecture.

Cons:

- Does not reduce HeyGen dependency immediately.
- LongCat output is not first-class in HiveMatrix until a later step.

### Approach B: Local MLX LongCat Backend, HeyGen Fallback

Add LongCat as an experimental local avatar backend on this Mac, using the MLX port and a backend choice such as `avatarRenderer: "longcat" | "heygen" | "remotion"`.

Pros:

- Best fit for this M5 Max 128 GB machine.
- Keeps avatar rendering local when the MLX worker is warm and healthy.
- Preserves HeyGen for reliability and urgent fallback.
- Gives HiveMatrix a vendor-independent renderer path.

Cons:

- Requires downloading 24-43 GB of weights.
- The MLX port is community-maintained, not official Meituan.
- First production integration must handle memory pressure, warmup time, failed renders, and long-running jobs carefully.

### Approach C: Remotion Default, LongCat Only For Hero Segments

Keep faceless/screen/cloned-voice Remotion as the default video format. Use LongCat only for intro/outro or special presenter shots, then composite those into the existing Remotion pipeline.

Pros:

- Matches existing HiveMatrix video decisions: avatar is optional and sparing.
- Limits render cost and operator wait time.
- Keeps the best parts of the current local factory.

Cons:

- More editing/compositing logic than a full-frame avatar-only output.
- Requires segment boundaries and output stitching rules.

## Recommendation

Use Approach B as the architecture direction, but execute it in the staged spirit of Approach A:

1. First prove local MLX LongCat on this Mac with the smallest reasonable model variant.
2. Prefer `q4-dmd-merged` for the first local proof because it is the smallest download and most likely to fit alongside HiveMatrix services.
3. If quality is poor, benchmark `q8-dmd-merged`.
4. Only after a successful proof render, add a HiveMatrix backend abstraction with LongCat marked experimental and HeyGen retained as fallback.

For the product default, keep Approach C's philosophy: Remotion remains the default video factory, LongCat is used for avatar moments or explicitly requested avatar videos.

## Proposed Acceptance Criteria For The Later Implementation Plan

- A design-approved implementation plan exists in `docs/superpowers/plans/2026-06-22-longcat-avatar-renderer.md`.
- Tests are written before production code.
- A local LongCat readiness script reports:
  - MLX importable.
  - Selected weights present.
  - Minimum free disk threshold.
  - Minimum available memory threshold or clear memory-pressure warning.
  - One tiny proof render can complete or fail with an actionable error.
- The avatar renderer choice is explicit and persisted/configurable.
- HeyGen remains available as fallback.
- The existing Remotion path remains unchanged for ordinary `/video/make`.
- Verification gates pass:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`

## Approval Question

Approve this direction?

Recommended approval: proceed with a staged local MLX LongCat proof using the smallest viable `q4-dmd-merged` variant first, with HeyGen retained as fallback and no production routing changes until the proof render succeeds.
