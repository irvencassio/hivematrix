# Archived Brain Docs Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-19-archived-docs-visibility-design.md`

Two independent repos, each with its own `swift test` gate:
- `/Users/irvcassio/Brainpower` (macOS)
- `/Users/irvcassio/Brainpower-iOS` (iOS)

Detection rule (both repos, identical): a doc is archived if any `/`-split
component of its `relativePath` equals `_archive`.

---

## Repo A — Brainpower (macOS)

### A1. `VaultDocument.isArchived`

- [ ] Add failing test in `Tests/brainpowerTests/` (new file
  `VaultDocumentArchiveTests.swift`):
  ```swift
  import XCTest
  @testable import brainpower

  final class VaultDocumentArchiveTests: XCTestCase {
      func makeDoc(relativePath: String) -> VaultDocument {
          let root = URL(fileURLWithPath: "/tmp/vault")
          let full = root.appendingPathComponent(relativePath)
          return VaultDocument(fullPath: full, vaultRoot: root, content: "",
                                creationDate: Date(), modifiedDate: Date())
      }

      func testTopLevelArchive() {
          XCTAssertTrue(makeDoc(relativePath: "_archive/foo.md").isArchived)
      }

      func testNestedArchive() {
          XCTAssertTrue(makeDoc(relativePath: "sources/notes/_archive/foo.md").isArchived)
      }

      func testNotArchived() {
          XCTAssertFalse(makeDoc(relativePath: "sources/notes/foo.md").isArchived)
      }

      func testPathContainingArchiveAsSubstringOnly() {
          // "not_archive" must not match — component equality, not substring.
          XCTAssertFalse(makeDoc(relativePath: "not_archive/foo.md").isArchived)
      }
  }
  ```
  Check `VaultDocument`'s actual initializer signature first
  (`Sources/brainpower/Models/VaultDocument.swift`) and adjust the fixture
  helper to match exactly — do not guess field names.
- [ ] Run `swift test --filter VaultDocumentArchiveTests` — watch it fail
  (compile error: no `isArchived` member).
- [ ] Add to `Sources/brainpower/Models/VaultDocument.swift`, next to the
  existing `section` computed property (~line 126):
  ```swift
  var isArchived: Bool {
      relativePath.split(separator: "/").contains("_archive")
  }
  ```
- [ ] Run the test again — watch it pass.

### A2. `VaultDocumentMeta.isArchived` (HTTP server / companion metadata)

- [ ] Add a case to `VaultServerRouterTests.swift` (or a new small test file)
  asserting a `VaultDocumentMeta` built with `relativePath:
  "_archive/foo.md"` reports `isArchived == true`. Check the actual struct
  fields in `Sources/brainpower/Services/VaultServer/VaultServerRouter.swift:27-42`
  before writing the fixture.
- [ ] Watch it fail.
- [ ] Add the same computed property to `VaultDocumentMeta`.
- [ ] Watch it pass.

### A3. `AppState.showArchivedDocs` setting

- [ ] Add a test in a new `Tests/brainpowerTests/AppStateArchiveSettingTests.swift`
  (or extend an existing AppState test file if one exists — check first)
  that: sets `UserDefaults.standard.removeObject(forKey: "showArchivedDocs")`,
  constructs `AppState`, asserts `showArchivedDocs == false` by default;
  then sets it `true`, asserts `UserDefaults.standard.bool(forKey:
  "showArchivedDocs") == true`.
- [ ] Watch it fail.
- [ ] In `Sources/brainpower/Models/AppState.swift`, next to `sortAscending`
  (~line 80-82):
  ```swift
  var showArchivedDocs: Bool = false {
      didSet { UserDefaults.standard.set(showArchivedDocs, forKey: "showArchivedDocs") }
  }
  ```
  And in `init`, next to the `sortAscending` restore (~line 119-121):
  ```swift
  if UserDefaults.standard.object(forKey: "showArchivedDocs") != nil {
      showArchivedDocs = UserDefaults.standard.bool(forKey: "showArchivedDocs")
  }
  ```
- [ ] Watch it pass.

### A4. Filter `AppState.filteredDocuments`

- [ ] Extend an AppState test (or new file) to build an `AppState` with two
  fake/injected `VaultDocument`s (one archived, one not — check how
  `AppState.documents` is populated/injectable in existing tests for the
  right seam; if `AppState` only loads from disk, use a temp directory
  fixture with a real `_archive/` subfolder instead, matching the pattern
  other tests in this suite already use for vault fixtures — see
  `VaultServiceMetadataTests.swift` for the temp-vault pattern). Assert:
  with `showArchivedDocs = false`, `filteredDocuments` excludes the archived
  doc; with `showArchivedDocs = true`, it's included.
- [ ] Watch it fail.
- [ ] In `AppState.filteredDocuments` (`AppState.swift:168-212`), add near
  the top of the filtering chain:
  ```swift
  var docs = documents
  if !showArchivedDocs {
      docs = docs.filter { !$0.isArchived }
  }
  ```
  and thread `docs` through the rest of the existing pipeline in place of
  whatever the current base collection variable is named (read the
  existing code first — don't introduce a second variable name for the
  same thing).
- [ ] Watch it pass.

### A5. Filter `AppState.search` results

- [ ] Test: seed a temp vault with a matching doc under `_archive/` and a
  matching doc outside it, run `appState.search(query:)` with
  `showArchivedDocs = false`, assert the archived one is absent from
  `searchResults`; flip the flag, assert it's present.
- [ ] Watch it fail.
- [ ] In `AppState.search(query:)` (`AppState.swift:573-662`), after
  `SearchResult`s are assembled into `searchResults`, add:
  ```swift
  if !showArchivedDocs {
      searchResults = searchResults.filter { !$0.isArchived }
  }
  ```
  This requires `SearchResult.isArchived` (add computed property to
  `Sources/brainpower/Models/SearchResult.swift`, same one-liner as
  `VaultDocument.isArchived`, derived from `path`).
- [ ] Watch it pass.

### A6. Settings UI toggle

- [ ] No test (SwiftUI view code, per this repo's existing convention — no
  view-level tests exist in the suite). Add to `SettingsView.swift`
  (`GeneralSettings`, near the sort-order control):
  ```swift
  Toggle("Show Archived Docs", isOn: $appState.showArchivedDocs)
  ```
  Match the exact binding pattern (`$appState...` vs `$state...`) already
  used by neighboring controls in that file.

### A7. Archived badge in doc list and search results

- [ ] No test (view code). In `DocumentRow`
  (`Sources/brainpower/Views/Sidebar/SidebarView.swift:255-301`), add an
  `archivebox` SF Symbol next to the pin icon, shown when
  `document.isArchived`:
  ```swift
  if document.isArchived {
      Image(systemName: "archivebox")
          .foregroundStyle(.secondary)
          .help("Archived")
  }
  ```
- [ ] In `SearchResultRow.standardRow`
  (`Sources/brainpower/Views/Search/SearchResultsPanel.swift:220-250`), add
  the same badge near the score badge, gated on `result.isArchived`.

### A8. Verify

- [ ] `swift build`
- [ ] `swift test`

---

## Repo B — Brainpower-iOS

### B1. `VaultDocument.isArchived`

- [ ] Add failing test to `Tests/BrainPowerTests/DocumentModelTests.swift`
  (or a new `VaultDocumentArchiveTests.swift` if that file is unrelated —
  check its contents first) mirroring A1's three cases (top-level, nested,
  substring-false-positive guard). Check `VaultDocument`'s actual
  initializer in `Sources/BrainPower/Models/VaultDocument.swift` before
  writing fixtures.
- [ ] Watch it fail.
- [ ] Add to `Sources/BrainPower/Models/VaultDocument.swift`, next to
  `section` (~line 34):
  ```swift
  var isArchived: Bool {
      relativePath.split(separator: "/").contains("_archive")
  }
  ```
- [ ] Watch it pass.

### B2. `VaultSearchResult.isArchived`

- [ ] Add a test in `Tests/BrainPowerTests/VaultIndexTests.swift` asserting
  a `VaultSearchResult` with `relativePath: "_archive/foo.md"` reports
  `isArchived == true`. Check the actual struct in
  `Sources/BrainPower/Services/VaultIndex.swift:4-13` first.
- [ ] Watch it fail.
- [ ] Add the same one-line computed property.
- [ ] Watch it pass.

### B3. `AppState.showsArchivedDocuments` setting

- [ ] Same shape as A3: default `false`, `didSet` writes
  `UserDefaults.standard`, restored in `init`. Add near
  `AppState.swift:13-14` (`isPinnedFilterEnabled`,
  `keepsPinnedDocumentsOnTop`), using key `"showArchivedDocs"` (same key
  name as macOS — not shared storage, just consistent naming).
- [ ] Test first (mirror A3's UserDefaults-roundtrip test), watch fail,
  implement, watch pass.

### B4. Filter `AppState.visibleDocuments`

- [ ] Test mirroring A4, using this repo's existing temp-vault fixture
  pattern (see `VaultScannerTests.swift` / `VaultRepositoryTests.swift` for
  how other tests build a fixture vault directory).
- [ ] Watch it fail.
- [ ] In `AppState.visibleDocuments` (`AppState.swift:115-158`), filter out
  archived docs when `showsArchivedDocuments == false`, before the existing
  folder/section/pinned filters (same shape as A4).
- [ ] Watch it pass.

### B5. Filter search results

- [ ] Test mirroring A5, using `VaultIndex.search` directly or through
  `AppState.search()` — check which is more directly testable in this
  suite (`VaultIndexTests.swift` tests the index directly; prefer that if
  it avoids needing a full `AppState` fixture).
- [ ] Watch it fail.
- [ ] In `AppState.search()` (`AppState.swift:453-461`), filter the array
  from `index.search(...)` by `!$0.isArchived` when the setting is off,
  before assigning to `searchResults`.
- [ ] Watch it pass.

### B6. Settings UI toggle

- [ ] No test (view code). Add to `BrainDirectorySettingsView.swift`:
  ```swift
  Toggle("Show Archived Docs", isOn: $appState.showsArchivedDocuments)
  ```
  in a `Section`, matching the file's existing `Form`/`Section` structure.

### B7. Archived badge in doc list and search results

- [ ] `DocumentRow` (`Sources/BrainPower/Views/DocumentListView.swift:272-322`)
  — mirror the existing `pin.fill` badge (lines 277-289) with an
  `archivebox` icon gated on `document.isArchived`.
- [ ] `SearchResultRow` (`Sources/BrainPower/Views/SearchView.swift:48-68`)
  — this row has no badge `HStack` today; wrap the title `Text` in an
  `HStack` and add the same `archivebox` icon gated on `result.isArchived`.

### B8. Verify

- [ ] `swift build`
- [ ] `swift test`

---

## Finishing (both repos)

- [ ] In each repo: `git status`, `git diff` — confirm only the intended
  files changed.
- [ ] Stage by explicit file name (never `git add -A`) in each repo
  separately.
- [ ] Commit each repo separately with its own message.
- [ ] Do not merge, do not push, do not release — report back to the
  operator with both commit SHAs.
