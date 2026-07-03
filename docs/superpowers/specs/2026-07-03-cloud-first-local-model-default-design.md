# Cloud-First Local Model Default Design

## Problem

A fresh HiveMatrix install must be buildable and usable before a local Qwen/Rapid-MLX model is installed. Today the code has two local-model assumptions that make this feel blocked:

- The first-run setup model row reports `needs_action` on local-capable Macs when Rapid-MLX has not been provisioned yet.
- `scripts/qwen-readiness.mts` exits with failure when no `qwen` profile exists in `~/.hivematrix/config.json`, even though no local model may be expected yet.

Rapid-MLX provisioning also writes `localEngine` but not the `qwen` profile that the readiness gate probes, so a successfully provisioned local engine can still leave the readiness script without a probe target.

## Goals

- Treat "no local model yet" as a valid cloud-first/default install state.
- Keep Rapid-MLX installation available from setup and the daemon console.
- Make local readiness strict when a Qwen profile exists, but non-blocking when no local profile has been configured.
- After Rapid-MLX provisioning succeeds, write enough `qwen` config for the readiness gate to probe the installed local endpoint.
- Preserve cloud-only behavior on Macs that cannot run local models.

## Non-Goals

- Do not install Rapid-MLX automatically during app build or release.
- Do not silently overwrite a user-supplied `qwen` profile.
- Do not change Apple signing, notarization, or updater packaging behavior.
- Do not change model routing beyond making the provisioning output coherent with the existing readiness probe.

## Approach

1. First-run setup will show local model provisioning as `not_requested` when a local-capable Mac has a Rapid-MLX plan but provisioning has not started. It remains actionable, but it is not an error.
2. The onboarding required gate will treat the absence of a local model as satisfied unless the user has explicitly opted into local-only mode. This keeps packaged builds and new installs cloud-first by default.
3. Rapid-MLX provisioning will write `localEngine` as it does today and, when no `qwen` profile exists, will also write a compatible `qwen` block pointing at the dense coding tier when available, otherwise the first provisioned tier.
4. `qwen-readiness.mts` will exit successfully with an explicit "not configured; skipped" message when no Qwen profile exists. If a profile exists, the existing six readiness checks and eval suite remain strict.

## Tests

- Setup status: a local-capable provisioning plan with idle/no-config state renders as `not_requested`, with a Rapid-MLX action.
- Onboarding: a config file without local model configuration is required-complete for the local-model step by default.
- Provisioning: pure helper logic emits a Qwen profile from a Rapid-MLX plan, preferring the coding tier and preserving existing profiles.
- Readiness script: with an empty temp home, `scripts/qwen-readiness.mts` exits 0 and reports that local Qwen readiness was skipped.

## Risks

The main risk is weakening the local-model verification gate too much. The design avoids that by only skipping when no profile exists; a configured profile that fails readiness still exits non-zero.
