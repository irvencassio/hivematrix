# Settings Observability Removal Design

## Problem

The console shows Observability in two places: the main screen right rail and a
separate Settings tab. The task requested removing the Settings copy because the
main screen already owns Observability access, but the prior run failed before
editing.

## Goal

Remove only the Settings Observability surface:

- no `Observability` tab in the Settings overlay;
- no `settingsObservability` panel;
- no `switchSettingsTab("observability")` routing;
- keep the main-screen Observability section and dedicated full-dashboard popup.

## Verification

Focused console tests should assert the Settings tab order excludes
Observability while the main right-rail section and `obsOverlay` dashboard remain.
