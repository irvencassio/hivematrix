# App Icon Choice Design

## Context

HiveMatrix currently ships its desktop icon from `assets/icon/icon-macos-master.svg.png`, generated into `src-tauri/icons/`. The current macOS master has an opaque white 1024px canvas and a dark green squircle inset from `100..924`, which creates the wide white border visible in the Dock.

The requested default is the full-bleed dark green icon: same mark and dark HiveMatrix identity, but the green/dark artwork fills the icon footprint like the Claude reference.

The follow-up request is to make the app icon selectable between:

- Dark green background.
- White background.

## Constraints

- The visible HiveMatrix UI is served by the daemon at `http://127.0.0.1:3747/console`, not by a bundled Tauri frontend origin.
- The Tauri shell intentionally has no ordinary frontend IPC surface for console actions. Existing comments in `src-tauri/src/lib.rs` call this out.
- Tauri exposes runtime window icon APIs, but the macOS Dock/app icon requires an `NSApplication.setApplicationIconImage(...)` path or equivalent shell-side behavior.
- The packaged icon in `src-tauri/icons/icon.icns` remains the installed app's default Finder/app bundle icon. A user preference can change the running Dock icon, but it should not mutate the signed `.app` bundle after install.

## Approaches

### Approach A: Default asset only

Regenerate the icon pipeline so the shipped app uses the full-bleed dark green icon. Keep no runtime selector.

Pros:

- Smallest change.
- Matches the immediate Dock request.
- Low risk for signing and update flow.

Cons:

- No selectable white variant.

### Approach B: Persisted selector, applied on next app launch

Add an "App icon" control in Settings -> General with "Dark green" and "White" choices. Persist the choice in `~/.hivematrix/config.json`. The Tauri shell reads that config on launch and applies the requested macOS runtime Dock icon.

Pros:

- Keeps UI settings with the existing theme/wallpaper controls.
- Avoids signed bundle mutation.
- Simple and reliable.
- Preference survives updates.

Cons:

- Changing the choice may require quitting/reopening HiveMatrix before the Dock icon changes.
- The installed Finder icon remains the bundled default.

### Approach C: Persisted selector with shell polling for near-immediate changes

Do Approach B, plus have the Tauri shell periodically read the config or a tiny daemon endpoint and update the Dock icon while the app is running.

Pros:

- Settings change can update the Dock icon during the current session.
- Still avoids signed bundle mutation.

Cons:

- More moving parts in the shell.
- More testing surface around timers, config reads, and native image loading.
- Less important than the core preference.

## Recommendation

Use Approach B now.

Ship the full-bleed dark green icon as the default packaged icon, add a full-bleed white variant as an alternate runtime icon, and expose the choice in Settings -> General. The UI should save the preference and show concise status text that the Dock icon updates after reopening HiveMatrix.

This gives the requested choice without making the signed app bundle mutable or adding background polling to the shell. A later pass can upgrade it to immediate switching if the restart requirement feels annoying in daily use.

## Acceptance Criteria

- `assets/icon/icon-macos-master.svg` and generated desktop assets use the full-bleed dark green icon without the wide white matte.
- A full-bleed white alternate icon asset exists for runtime use.
- Settings -> General includes an "App icon" selector with "Dark green" and "White".
- `GET /models` and `POST /settings` include/persist the app icon choice.
- Unit tests cover the settings UI and config accessor behavior.
- `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
