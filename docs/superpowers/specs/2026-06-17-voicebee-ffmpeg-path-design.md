# VoiceBee Desktop Bring-Up Design

## Problem

VoiceBee Live stays on "Connecting" and push-to-talk voice can return an ffmpeg-related error from the installed app. The installed launchd daemon currently runs with the sparse GUI PATH `/usr/bin:/bin:/usr/sbin:/sbin`, while ffmpeg is installed at `/opt/homebrew/bin/ffmpeg`. The Python sidecar inherits that sparse PATH, so STT/TTS tools that shell out to `ffmpeg` can fail even though ffmpeg works in Terminal.

The desktop Talk button can also show "mic blocked — allow microphone access" before any request reaches the daemon. The installed Tauri app bundle does not include `NSMicrophoneUsageDescription`, so macOS cannot present a clean microphone permission prompt for `com.cassio.hivematrix`.

## Approach

1. Add a durable CLI PATH to the bundled daemon launchd plist generated during onboarding.
2. Pass the same CLI PATH explicitly to VoiceBee child processes so dev, tests, and future launch environments do not depend on the parent process PATH.
3. Add a Tauri `Info.plist` merge file with `NSMicrophoneUsageDescription` so future signed builds request microphone access correctly.
4. Patch the current installed launchd plist and app bundle, reload/restart both processes, and reset/request the macOS microphone grant to repair the live app immediately.

## Verification

- Unit test the daemon plist includes Homebrew PATH entries.
- Run focused voice/onboarding tests.
- Run typecheck, test, and scope wall.
- Verify the live daemon process environment includes `/opt/homebrew/bin`.
- Verify the installed app bundle includes `NSMicrophoneUsageDescription` and remains code-signed.
