# VoiceBee Desktop Bring-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add a failing assertion in `src/lib/onboarding/actions.test.ts` that `buildDaemonPlist` emits a PATH containing `/opt/homebrew/bin`.
- [ ] Update `src/lib/onboarding/actions.ts` so bundled launchd plists include `PATH` from `buildCliPath()`.
- [ ] Update VoiceBee child process launches in `src/lib/voice/realtime-session.ts`, `src/lib/voice/provision.ts`, `src/lib/voice/tts.ts`, and the `/voice/turn` path in `src/daemon/server.ts` to pass the same PATH.
- [ ] Add `src-tauri/Info.plist` with `NSMicrophoneUsageDescription` so desktop Talk can request mic access.
- [ ] Run focused tests for onboarding and voice modules, then run the required repo gates.
- [ ] Patch the installed launchd plist, reload the launchd job, patch/re-sign the installed app bundle, and confirm the live environment can see `/opt/homebrew/bin` plus the microphone usage key.
