# Wallpaper & Material Shell — Design Spec

**Date:** 2026-06-29
**Status:** Brainstorm / Design
**Scope:** macOS-style layered material system and CSS token definitions for the HiveMatrix shell

---

## Context

HiveMatrix already has the raw ingredients of a material system:

| Layer | Current state |
|---|---|
| Native vibrancy | `window-vibrancy` crate applies `NSVisualEffectMaterial::UnderWindowBackground` on startup (`src-tauri/src/lib.rs:94-99`) |
| Window transparency | `"transparent": true` in `tauri.conf.json:22` |
| Backdrop blur | Three values in use: header = 24 px, columns = 20 px, wallpaper panels = 6 px |
| Tint tokens | `--panel`, `--panel-2` carry per-theme RGBA values |
| Wallpaper | `--wp-opacity` (0-100) + `--wp-blur` (6 px / 0 px) in `src/daemon/console.ts:62-69` |

These are implicit and scattered. This spec defines an explicit, composable material token system that can serve the shell, lane apps, and future surfaces.

---

## Goals

1. **Named material levels** — four tiers matching macOS Human Interface Guidelines semantics.
2. **Per-theme token sets** — dark, light, matrix (neon), and system (OS-delegated).
3. **Wallpaper integration** — first-class tokens so any surface can participate in the wallpaper tint without ad-hoc CSS.
4. **Single source of truth** — all blur, saturation, tint-alpha, and shadow values live in `--mat-*` tokens; existing `--panel`, `--border`, `--bg` tokens reference them.
5. **No new dependencies** — pure CSS custom properties + existing `window-vibrancy` crate.

---

## Material Tier Model

Borrowing Apple's naming but mapped to HiveMatrix's actual surfaces:

```
┌─ CHROME ─────────────────────────────────────────────────────┐  ← window chrome, titlebar (24 px blur)
│  ┌─ REGULAR ──────────────────────────────────────────────┐  │  ← sidebars, panel columns (20 px blur)
│  │  ┌─ THICK ───────────────────────────────────────────┐ │  │  ← cards, popover bodies (14 px blur)
│  │  │  ┌─ THIN ──────────────────────────────────────┐  │ │  │  ← tooltips, transient overlays (8 px blur)
│  │  │  └─────────────────────────────────────────────┘  │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Each tier defines: `blur`, `saturation`, `tint-alpha`, `shadow`.

---

## Token Definitions

### Base material tokens (theme-independent)

```css
:root {
  /* ── Blur radii ─────────────────────────────────────── */
  --mat-blur-chrome:  24px;
  --mat-blur-regular: 20px;
  --mat-blur-thick:   14px;
  --mat-blur-thin:     8px;

  /* ── Saturation multipliers ─────────────────────────── */
  --mat-sat-chrome:  180%;
  --mat-sat-regular: 160%;
  --mat-sat-thick:   140%;
  --mat-sat-thin:    120%;

  /* ── Backdrop-filter shorthands ─────────────────────── */
  --mat-chrome:  blur(var(--mat-blur-chrome))  saturate(var(--mat-sat-chrome));
  --mat-regular: blur(var(--mat-blur-regular)) saturate(var(--mat-sat-regular));
  --mat-thick:   blur(var(--mat-blur-thick))   saturate(var(--mat-sat-thick));
  --mat-thin:    blur(var(--mat-blur-thin))    saturate(var(--mat-sat-thin));

  /* ── Tint alphas (base; themes override) ────────────── */
  --mat-tint-alpha-chrome:  0.82;
  --mat-tint-alpha-regular: 0.72;
  --mat-tint-alpha-thick:   0.86;
  --mat-tint-alpha-thin:    0.55;

  /* ── Shadow tokens ──────────────────────────────────── */
  --mat-shadow-chrome:  0 1px 0 var(--mat-border);
  --mat-shadow-regular: 0 1px 3px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.12);
  --mat-shadow-thick:   0 2px 8px  rgba(0,0,0,.20), 0 1px 2px  rgba(0,0,0,.16);
  --mat-shadow-thin:    0 1px 4px  rgba(0,0,0,.14);

  /* ── Wallpaper participation ─────────────────────────── */
  --mat-wp-blur:        6px;          /* when wallpaper active */
  --mat-wp-sat:         160%;
  --mat-wp-opacity:     0.82;         /* mirrors ThemeSettings.wallpaperOpacity / 100 */
}
```

### Dark theme tints

```css
:root,
html[data-theme="dark"] {
  --mat-bg:             #0d1117;
  --mat-border:         rgba(45,51,59,.80);

  /* tint colors per tier */
  --mat-tint-chrome:    rgba(22,27,34,  var(--mat-tint-alpha-chrome));
  --mat-tint-regular:   rgba(22,27,34,  var(--mat-tint-alpha-regular));
  --mat-tint-thick:     rgba(28,34,48,  var(--mat-tint-alpha-thick));
  --mat-tint-thin:      rgba(13,17,23,  var(--mat-tint-alpha-thin));

  /* semantic aliases (keep existing --panel working) */
  --panel:              var(--mat-tint-regular);
  --panel-2:            var(--mat-tint-thick);
  --overlay-bg:         rgba(0,0,0,.55);
}
```

### Light theme tints

```css
html[data-theme="light"] {
  --mat-bg:             #f6f8fa;
  --mat-border:         rgba(208,215,222,.80);

  --mat-tint-chrome:    rgba(255,255,255, var(--mat-tint-alpha-chrome));
  --mat-tint-regular:   rgba(255,255,255, var(--mat-tint-alpha-regular));
  --mat-tint-thick:     rgba(240,243,246, var(--mat-tint-alpha-thick));
  --mat-tint-thin:      rgba(255,255,255, var(--mat-tint-alpha-thin));

  --panel:              var(--mat-tint-regular);
  --panel-2:            var(--mat-tint-thick);
  --overlay-bg:         rgba(0,0,0,.25);
}
```

### Matrix theme tints

```css
html[data-theme="matrix"] {
  --mat-bg:             #010a05;
  --mat-border:         rgba(29,90,50,.80);

  --mat-tint-chrome:    rgba(4,20,11,   var(--mat-tint-alpha-chrome));
  --mat-tint-regular:   rgba(4,20,11,   var(--mat-tint-alpha-regular));
  --mat-tint-thick:     rgba(10,33,19,  var(--mat-tint-alpha-thick));
  --mat-tint-thin:      rgba(1,10,5,    var(--mat-tint-alpha-thin));

  --panel:              var(--mat-tint-regular);
  --panel-2:            var(--mat-tint-thick);
  --overlay-bg:         rgba(0,10,4,.70);
}
```

---

## Surface Map

How each shell surface maps to a material tier:

| Surface | Tier | CSS rule |
|---|---|---|
| Window titlebar / header | chrome | `backdrop-filter: var(--mat-chrome)` |
| Left sidebar (lane list) | regular | `backdrop-filter: var(--mat-regular)` |
| Right sidebar (context) | regular | `backdrop-filter: var(--mat-regular)` |
| Chat column | regular | `backdrop-filter: var(--mat-regular)` |
| Cards / message bubbles | thick | `backdrop-filter: var(--mat-thick)` |
| Popovers / dropdowns | thick | `backdrop-filter: var(--mat-thick)` |
| Tooltips | thin | `backdrop-filter: var(--mat-thin)` |
| Modal overlays | thin + overlay-bg | overlay approach (see below) |
| Wallpaper panels (active) | wp override | `blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat))` |

### Wallpaper mode override

When `html[data-wallpaper="1"]` is set, regular and chrome tiers must reduce their blur so the wallpaper shows through. The wallpaper blur (`--mat-wp-blur: 6px`) is applied instead of the tier blur. Tint alpha rides on `--mat-wp-opacity`.

```css
html[data-wallpaper="1"] .mat-chrome,
html[data-wallpaper="1"] .mat-regular {
  backdrop-filter: blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat));
  /* tint opacity driven by --mat-wp-opacity, not tier alpha */
}
```

The `ThemeSettings.wallpaperOpacity` (0-100 int) from `src/lib/models/available.ts:144` maps as:

```ts
// when wallpaper path set, write to CSS:
document.documentElement.style.setProperty('--mat-wp-opacity', (opacity / 100).toFixed(2));
```

---

## Semantic Color Tokens

These are unchanged from the existing system but should be declared after material tokens so they can reference `--mat-bg` / `--mat-border`:

```css
/* semantic palette — declare per theme, after material block */
--bg:           var(--mat-bg);
--border:       var(--mat-border);
--text:         /* per theme */;
--muted:        /* per theme */;
--accent:       /* per theme */;
--accent-2:     /* per theme */;
--ok:           /* per theme */;
--warn:         /* per theme */;
--err:          /* per theme */;
```

Full per-theme values are already defined in `src/daemon/console.ts:19-61` and are not changed by this spec — only reordered so `--mat-*` tokens come first.

---

## Native Vibrancy Alignment

The `window-vibrancy` crate's `NSVisualEffectMaterial::UnderWindowBackground` targets the entire window container. It is not per-surface. The CSS material tiers sit _on top of_ this native blur, which means:

- At the chrome level, native + CSS blur compounds. Native contributes the OS-correct look; `--mat-blur-chrome` adds refinement.
- For headless/non-macOS surfaces (lane apps rendered via Tauri on Linux/Windows or without native vibrancy), the CSS tier is the sole blur source — values must work standalone.
- Do not remove the `apply_macos_vibrancy()` call; it provides the wallpaper/desktop color bleed that CSS alone cannot replicate.

---

## Shadow System

Shadows pair with tiers:

```
chrome  → border-bottom only (1px solid var(--mat-border))
regular → card-shadow:  0 1px 3px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.12)
thick   → popover:      0 2px 8px  rgba(0,0,0,.20), 0 1px 2px  rgba(0,0,0,.16)
thin    → tooltip:      0 1px 4px  rgba(0,0,0,.14)
matrix  → glow variant: 0 0 12px  rgba(57,255,126,.07) on regular
```

Matrix theme replaces drop-shadows with a neon glow at the regular tier only; chrome keeps the border approach.

---

## Migration Path

1. Add the `--mat-*` token block at the top of the `:root` declaration in `src/daemon/console.ts`.
2. Replace the three hard-coded `backdrop-filter` values (header 24 px, `.col` 20 px, wallpaper 6 px) with `var(--mat-chrome)`, `var(--mat-regular)`, and the wallpaper override pattern.
3. Update `--panel` and `--panel-2` to reference `var(--mat-tint-regular)` and `var(--mat-tint-thick)`.
4. Write `--mat-wp-opacity` from TypeScript when wallpaper path changes.
5. Lane apps (Browser Lane, Terminal Lane) inherit this token set from a shared CSS import rather than duplicating values.

---

## Open Questions

1. **Should `--mat-tint-alpha-*` be overridable per theme, or is a per-tier default sufficient?** Currently matrix has a slightly different "feel" — may want `--mat-tint-alpha-regular: 0.85` in matrix to keep the deep color.
2. **Wallpaper blur slider** — `ThemeSettings.wallpaperOpacity` controls tint opacity, not blur. Should there be a separate `wallpaperBlur` knob (0-24 px), or is 6 px fixed?
3. **Lane app scope** — do lane apps use a reduced token set (regular + thick only, no chrome) since they have their own titlebars?
4. **System theme** — when `ThemeMode = "system"`, should we read `prefers-color-scheme` and apply dark/light tokens, or rely on native vibrancy alone?
