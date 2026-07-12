# Companion Ports — Master Plan (2026-07-11)

Authored by Fable (research + spec). Execution: Sonnet workers managed by Opus track managers.
Tracks: **A** daemon FCM · **B** hivematrix-android parity+tablet · **C** hivematrix-androidwatch (new) · **D** hivematrix-glasses Ray-Ban Display refresh.

## Ground truth (from the 2026-07-11 research sweep)

- Daemon: single hand-rolled Node http server `~/hivematrix/src/daemon/server.ts` (~262 routes). Auth = one shared bearer token (`Authorization: Bearer` or `?token=` for SSE), public routes only `/health`, `/`, `/console`. Optional Cloudflare Access service-token headers `CF-Access-Client-Id/Secret` on every request when set.
- Pairing wire format (QR + WatchConnectivity + everything): `{"type":"hivematrix-connection","version":1,"url","token","cloudflareAccess":{"clientId","clientSecret"}?}`. QR endpoints: `GET /tunnel/qr` (Tailscale), `GET /tunnel/qr/cloudflare`. Pro-gated by `companion_pairing`.
- Two-transport posture: **Tailscale** (phone; `*.ts.net` / `100.64.0.0/10`) and **Cloudflare named tunnel** (watch + off-mesh; requires CF Access headers when configured). Watches (any brand) must reject tailnet URLs at pairing.
- Push: daemon speaks **APNs only** (`src/lib/notify/apns.ts`, zero-dep ES256 JWT + http2). `POST /devices/register {token, env, platform}` stores platform but never branches. **No FCM anywhere** → Track A.
- Voice: `POST /voice/turn` (130s) = non-streaming alias over Flash Lane. Response `{transcript, reply, audioBase64?, actions?[TurnAction], sessionId?, command?}`. `TurnAction = {type:"dial"|"sms", label, number}`. `POST /flash/turn` = SSE (token/tool_start/tool_result/done/error; `done` carries `fullText`, `audioBase64?`, `command?`). Live voice = Pipecat SmallWebRTC via `GET /voice/rtc/config` + `POST/PATCH /voice/rtc/offer`. `/voice/turn` 403s when the `voice` feature flag is off.
- Live updates: `GET /events?token=` SSE (`tasks:*`, `connectivity:*`, `directives:*`, `flash:*`). iOS throttles SSE-triggered refresh to ~1.3/s with 0.75s trailing coalesce; 30s backstop poll (5s when SSE down).
- **Scope-walls (do NOT port):** Flights/Work Packages (removed 2026-07-06), personal Goals surface, HeyGen/video factory, Ideation. `scripts/scope-wall.mjs` enforces on the daemon; keep companions consistent.
- iOS is the parity reference: `~/hivematrix-ios` (v0.2.9). iPad = daemon web `/console` in a WKWebView with a fetch-patch script injecting CF-Access headers + token into localStorage (`DesktopWebConsoleView.swift`). Phone = 6 tabs (Chat/Board/Documents/Directives/Approvals/Settings).
- watchOS reference: `~/hivematrix-watch` (standalone) + embedded twin in hivematrix-ios. 8s foreground poll, no SSE. Complications fed by an app-group `ComplicationSnapshot` written after each poll. Receive-only credential sync (message keys `payload` / `hivematrixConnection`).

## Shared decisions (all tracks)

1. **Platform strings:** `ios`, `watchos`, `android`, `wearos` in `/devices/register`. Glasses stays under the iOS app umbrella (phone-hosted).
2. **Pairing envelope is frozen** at `hivematrix-connection` v1. Every new client parses it identically (incl. `cloudflareAccess`).
3. **Push strategy:** FCM HTTP v1 from the daemon (Track A). Until Irv creates the Firebase project (manual step — service account JSON + real `google-services.json`), Android/Wear rely on `/events` SSE (foreground) + WorkManager 15-min poll (background). Code must land push-ready.
4. **Tablets follow the iPad precedent:** expanded-width devices get the daemon web console in a WebView (token → localStorage, CF-Access header injection via request interception), native tabs otherwise. Window-size-class polish on native screens is secondary.
5. **Flights dies everywhere.** Delete Android's feature/flights + service endpoints + models + tests.
6. **Voice ladder on Android:** (1) keep Flash SSE Talk; (2) wire the existing-but-unused `/voice/turn` audio path into UI: SpeechRecognizer STT → voiceTurn → play `audioBase64` (Kokoro AAC) via ExoPlayer/MediaPlayer + render `actions` as tel:/sms: intent buttons; (3) Live voice via `ai.pipecat:small-webrtc-transport` (Kotlin, Maven Central) against `/voice/rtc/*`.
7. **Verification gate:** every track ends with a real build + unit tests green, exercised end-to-end where possible. macOS host currently has **no JDK and no Android SDK**: Android tracks must first bootstrap `brew install --cask temurin@17` (or openjdk@17) + `android-commandlinetools` + `sdkmanager --licenses`, `ANDROID_HOME` in the track worktree env. If installs are permission-blocked, STOP and report "code-complete, build-unverified" honestly — do not claim green.
8. Xcode + xcodegen exist on this host (iOS/watch release scripts prove it) → glasses track verifies with `xcodegen generate && xcodebuild build` (scheme HiveMatrixGlasses, generic iOS destination, code signing off for CI-style build).

## Track A — daemon FCM (small, unblocks push parity)

- `src/lib/notify/fcm.ts` mirroring `apns.ts`: zero-dep — sign a service-account JWT (RS256, `node:crypto`), exchange at `oauth2.googleapis.com/token` (cache ~50min), POST `https://fcm.googleapis.com/v1/projects/<id>/messages:send` over `node:https`. Config in `~/.hivematrix/config.json` under `fcm: {serviceAccountPath | serviceAccount, devices?}`.
- Device registry: branch on `platform` — `android`/`wearos` tokens go to FCM, `ios`/`watchos` (and legacy missing platform) to APNs. Registration/unregistration stays on the existing `/devices/register|unregister` routes; store platform per token.
- Unify callers: a `sendPush(payload, opts)` in `src/lib/notify/` that fans out to both senders; update the three call sites (morning briefing, `/heartbeat/run`, voice loop-closer).
- Tests: JWT/claim shaping, device grouping, payload mapping (alert title/body → FCM notification message). Follow existing daemon test conventions.
- Manual follow-up for Irv (report, don't attempt): create Firebase project, service-account key, real `google-services.json` for both Android apps.

## Track B — hivematrix-android (spec: `~/hivematrix-android/docs/PARITY-SPEC.md`)

## Track C — hivematrix-androidwatch (spec: `~/hivematrix-androidwatch/docs/SPEC.md`)

## Track D — hivematrix-glasses (spec: `~/hivematrix-glasses/docs/display-refresh-spec.md`)

## Sequencing

A ∥ B ∥ D start immediately. C starts immediately too (standalone pairing = paste/manual works without the phone app), but its phone-side Data Layer credential sync lands in B's repo — coordinate: B owns "Sync Wear watch" in the Android app settings; C owns the receiver. FCM wiring in B/C activates when A lands (still code-complete regardless).

## Reporting

Each track manager reports: features shipped, build/test evidence (exact commands + tail of output), deviations from spec with reasons, and any manual steps left for Irv. No self-graded "done" without the verification gate.
