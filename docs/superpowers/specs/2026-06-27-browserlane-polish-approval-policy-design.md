# BrowserLane Polish + Approval Policy Design

**Date:** 2026-06-27

## Problem Statement

Nine reported issues across BrowserLane (native app), HiveMatrix console (web UI), and the task-execution approval hook:

1. **Window size not persisted** — BrowserLane opens at the hardcoded 960×640 every launch
2. **Icon resets to dark on close** — `applicationIconImage` is in-memory only; Dock reverts to bundle icon after quit
3. **Icon size wrong for white** — White icon may render at wrong size via `NSWorkspace.setIcon`
4. **Overview color coding missing** — Failed/in-progress/review numbers lack status colors
5. **No drag-drop to task form** — Attachments require clicking "Browse files", no drop zone
6. **Translucency=0 still blurs** — `backdrop-filter: blur(6px)` is hardcoded regardless of opacity
7. **New task form too narrow** — Form is in the narrow board column; should open in center session column
8. **"Directives" → "Scheduled"** — Misleading label; "Scheduled" reflects the actual use case
9. **CCD session tools prompt for approval** — `mcp__ccd_session__*` tools should be auto-approved per AGENTS.md

## Approach

### A. Window persistence (AppDelegate.swift)
Set `window.frameAutosaveName = "BrowserLaneMain"` before showing. AppKit saves/restores via UserDefaults key `"NSWindow Frame BrowserLaneMain"`. Center only on first launch (no saved frame).

### B. Icon persistence (BrowserLaneSettings.swift)
After setting `applicationIconImage`, call `NSWorkspace.shared.setIcon(_:forFile:options:)` with `Bundle.main.bundlePath`. This writes a persistent xattr on the bundle so the Dock shows the correct icon even when the app is not running. The app is not sandboxed, so there are no entitlement restrictions.

### C. Overview color coding (console.ts)
Extend `card()` to accept a number color. Add a `laneColor` map: `in_progress → var(--accent)`, `review → var(--ok)`, `failed → var(--err)`. Only color when count > 0 for failed/in-progress (always for review).

### D. Drag-drop attachment (console.ts)
Add `ondragover`/`ondragleave`/`ondrop` to the `.attach-row` div. On drop, extract `event.dataTransfer.files` and pass to the existing `onAttachFiles()` function (which accepts `{files: FileList}`). Add CSS for drag-over state.

### E. Translucency blur fix (console.ts)
Add CSS variable `--wp-blur` defaulting to `6px`. Wherever `--wp-opacity` is set in JS, also set `--wp-blur` to `"6px"` when opacity > 0 or `"0px"` when opacity === 0. Change CSS from `backdrop-filter: blur(6px)` to `backdrop-filter: blur(var(--wp-blur, 6px))`.

### F. New task center window (console.ts)
When "New task" is clicked, call `showNewTaskPanel()` which DOM-moves the `#taskForm` element into `#session` with a wrapper div. All existing form JS works unchanged (element IDs are preserved). Guard `renderOverview()` from overwriting while the panel is shown. `cancelForm('taskForm')` and `createTask()` success both call `_closeNewTaskPanel()` to move form back and restore overview.

### G. Directives → Scheduled (console.ts)
Rename UI-visible text only. Keep internal: IDs (`dirSec`, `dirForm`), function names (`renderDirectives`, `createDirective`), API paths (`/directives`), DB field names. Change: section summary, button labels, overview card label, briefing text.

### H. CCD session approval (approval.ts + existing hook)
In `generateHookScript()`, add a whitelist block before the catch-all MCP block:
```bash
case "$TOOL_NAME" in
  mcp__ccd_session__*|mcp__superpowers__*)
    exit 0
    ;;
esac
```
Also patch the live hook at `~/.hivematrix/hooks/29bda7c0557f40b083cc5c7e.sh` with the same addition.

## Acceptance Criteria

- BrowserLane window opens at previous size/position after relaunch
- White icon persists in Dock after BrowserLane quits
- Overview: failed number red, in-progress gold, review green
- Files can be dragged onto the task form attachment zone
- Setting wallpaper translucency to 0% removes all blur
- New task form opens in the wider center column
- Section heading reads "Scheduled" (not "Directives")
- `mcp__ccd_session__spawn_task` does not prompt for approval during task execution
