# Archived Brain Docs Visibility — Design

## Problem

Brain docs under an `_archive/` path prefix are invisible to the operator in
both the Brainpower macOS app and brainpower-ios. There's no way to browse or
search them without leaving the app (e.g. `Finder`/`grep`). The operator wants
to keep archived docs out of the way by default but reachable when needed,
without deleting them.

## Scope

Two independent Swift codebases, same conceptual change in each:
- `/Users/irvcassio/Brainpower` (macOS, Swift Package, XCTest)
- `/Users/irvcassio/Brainpower-iOS` (iOS, Swift Package, XCTest)

No server-side change — both apps scan/index the vault directory tree
locally (or via the vault HTTP server for the iOS remote-vault path), so
"archived" is a client-side classification derived from path, not new data
written into the vault.

## Detection rule

A doc is **archived** if any path component of its vault-relative path is
literally `_archive` (e.g. `_archive/foo.md`, `sources/notes/_archive/bar.md`).
One rule, works for top-level and nested archive folders, mirrors how
`VaultSection` already classifies docs by path prefix in both apps.

```swift
var isArchived: Bool {
    relativePath.split(separator: "/").contains("_archive")
}
```

## Settings toggle

- Key: `showArchivedDocs` (Bool), default `false` (hidden).
- macOS: new `AppState.showArchivedDocs` property, same shape as the
  existing `sortAscending` property (`AppState.swift:80-82`, restored at
  `AppState.swift:119-121`) — plain `Bool` with a `didSet` that writes
  `UserDefaults.standard`, restored in `init`. UI: a `Toggle` in
  `GeneralSettings` (`SettingsView.swift`).
- iOS: same pattern, added to `AppState`, restored in `init`. UI: a `Toggle`
  in `BrainDirectorySettingsView.swift` (first `Toggle` in that file — no
  existing one to extend).

No new persistent store, no DB migration, no server change — reuses
`UserDefaults`, the existing per-app settings mechanism. Consistent with the
Complexity Budget in AGENTS.md.

## Filtering — the two chokepoints per app

Each app already has exactly one place the doc list is assembled and one
place search results are assembled; filter in both, gated on the setting:

**macOS**
- Doc list: `AppState.filteredDocuments` (`AppState.swift:168-212`).
- Search: `AppState.search(query:)` (`AppState.swift:573-662`), filtering
  `searchResults` after `SearchService.search` returns (covers the ripgrep
  fallback, HTML fallback, and semantic search uniformly, since they all
  merge into `searchResults` before any downstream AI synthesis runs).

**iOS**
- Doc list: `AppState.visibleDocuments` (`AppState.swift:115-158`).
- Search: `AppState.search()` (`AppState.swift:453-461`), filtering the
  array returned by `VaultIndex.search(...)` before assigning to
  `searchResults`. No SQLite schema/migration change — `isArchived` is
  derived from `relativePath` at read time in Swift, not stored as a column.

When the toggle is off, archived docs never reach `documents`/`searchResults`
consumers. When on, they appear like any other doc, with a badge.

## Visual indicator

A small badge next to the title in the doc-list row and the search-result
row, shown only for archived docs (a no-op distinction when the toggle is
off, since archived docs aren't in the list at all then).

- macOS: `DocumentRow` (`SidebarView.swift:255-301`) and
  `SearchResultRow.standardRow` (`SearchResultsPanel.swift:220-250`) — an
  `archivebox` SF Symbol icon, styled like the existing pin icon.
- iOS: `DocumentRow` (`DocumentListView.swift:272-322`, mirrors the existing
  `pin.fill` badge at lines 277-289) and `SearchResultRow`
  (`SearchView.swift:48-68`, which has no badge infra today — add one).

## What's explicitly out of scope

- No change to `VaultService`/`VaultScanner` skip-list — archived docs must
  still be scanned (they need to be filterable, not excluded), unlike
  `.git`/`node_modules`/etc.
- No change to the AI embedding index build (`EmbeddingService`,
  `AppState.buildIndex()`) — it indexes `AppState.documents` (the raw,
  unfiltered list) already; synthesis reads from the filtered
  `searchResults`, so archived content won't leak into AI answers when
  hidden, without touching the indexer itself.
- No new `VaultSection` case — archived-ness is orthogonal to section
  (a doc keeps its section; it's just also archived).

## Test plan (TDD, one failing test per behavior)

macOS (`Tests/brainpowerTests/`):
1. `VaultDocument.isArchived` true for `_archive/x.md` and
   `a/_archive/x.md`, false otherwise.
2. `AppState.filteredDocuments` excludes archived docs when
   `showArchivedDocs == false`, includes them when `true`.
3. `AppState.search` results exclude archived matches when the setting is
   off (requires a fixture doc under `_archive/` with matching content).

iOS (`Tests/BrainPowerTests/`):
1. `VaultDocument.isArchived` — same cases as macOS.
2. `AppState.visibleDocuments` excludes/includes based on the setting.
3. `VaultIndex`/`AppState.search` results filtering — same as macOS.

## Rollout

Each repo gets its own commit, staged by explicit file name (per AGENTS.md
git hygiene — these are separate repos from `hivematrix`, not part of this
checkout's shared tree, so the "don't `git add -A`" rule is about not
sweeping in unrelated uncommitted work within each of those repos too).
