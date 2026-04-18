# Asset Storage Architecture — Filename-as-Identity, Metadata-Driven Type

## Objective

Redesign Bakin's asset storage so that:

1. **Filename is identity.** A file's name on disk uniquely identifies it forever. References hold the filename. Never a path.
2. **Path is a pure function of filename.** Given a filename like `20260401-hero-a1b2c3d4.png`, its path is derivable from the date prefix alone: `store/2026-04/20260401-hero-a1b2c3d4.png`. No in-memory map, no resolver, no watcher-based lookup.
3. **Type is metadata, not location.** `type`, `taskId`, `tags`, `description` live in the sidecar. Changing them is a JSON edit. Zero file moves. Zero reference updates.
4. **Manual drops still work.** Users dragging files into `~/.bakin/assets/inbox/` get them ingested: canonical filename generated, moved into `store/`, stub sidecar written.

Net effect: the class of bug that motivated this redesign (moving files invalidates stored paths) becomes structurally impossible.

## Background

This spec supersedes an earlier plan ("filename-as-identity + physical type dirs + in-memory resolver"). That plan correctly identified filename as identity but kept `assets/{type}/{taskId}/` as the physical layout — which meant retype still moved files and required a resolver. This revision eliminates both the file move and the resolver by deriving path from the filename itself.

## Storage Layout

```
~/.bakin/assets/
  store/{YYYY-MM}/{filename}              ← canonical location (all files)
  store/{YYYY-MM}/{filename}.meta.json    ← sidecars, colocated
  store/.trash/{filename}{.meta.json}     ← soft-deleted (30-day expiry)
  inbox/                                  ← human drop zone
  inbox/{type}/                           ← optional type-hint subdirs
  archive/{filename}/{sha256}.{ext}       ← version history (phase 2, deferred)
```

### Why `{YYYY-MM}` sharding?

- Derivable from filename (`YYYYMMDD` prefix).
- Caps per-directory file count (~few thousand even for heavy content months on APFS).
- Makes "find all assets from March" a trivial `ls`.
- User-understandable if they ever look in Finder.

### What's gone

- `assets/{type}/` dirs — type lives in sidecar only.
- `assets/{type}/{taskId}/` dirs — taskId lives in sidecar only.
- `plugins/assets/lib/resolver.ts` — no longer needed; path is pure-function of filename.
- Retype/relink physical-move logic — both become one-line sidecar edits.

## Identity and Path Derivation

### Canonical filename format

`YYYYMMDD-{slug}-{id8}.{ext}`

- `YYYYMMDD` — ingest date. Drives path shard.
- `{slug}` — lowercase, hyphenated, derived from source name or description.
- `{id8}` — 8 hex chars from crypto-random. Makes filename globally unique forever.
- `{ext}` — file extension.

Examples:
- `20260401-q2-hero-a1b2c3d4.png`
- `20260415-content-strategy-e5f6a7b8.md`

### Path function

```typescript
// plugins/assets/lib/path-for-filename.ts
export function pathForFilename(filename: string): string | null {
  const m = /^(\d{4})(\d{2})\d{2}-/.exec(filename)
  if (!m) return null                           // not a canonical filename
  return `assets/store/${m[1]}-${m[2]}/${filename}`
}
```

That's it. No lookups, no state, no race conditions. Consumers call this to resolve a filename to an on-disk path.

### Non-canonical filenames

Legacy filenames without a `YYYYMMDD-` prefix cannot be stored. The migration script canonicalizes every existing file. Post-migration, every file in `store/` has a canonical name. Files without canonical names in `inbox/` get canonicalized during ingestion.

## Core Operations

### Create (agent-driven: `bakin_exec_assets_save`)

1. Caller provides `filePath`, `type`, `taskId`, `description`, `tags`, `tool`, optional `slug`.
2. `saveAsset()` generates canonical filename: `${today}-${slug}-${id8}.${ext}`.
3. Writes file to `store/{YYYY-MM}/{filename}`.
4. Writes sidecar to `store/{YYYY-MM}/{filename}.meta.json` with all metadata.
5. Indexes in search (key = filename).
6. Returns `{ ok: true, filename }`.

Return shape no longer includes `path` — callers only need the filename.

### Read (content or metadata)

- `GET /api/assets/{filename}` — serves file bytes. Handler calls `pathForFilename`, reads file.
- `bakin_exec_assets_open` — returns sidecar + extracted text content by filename.
- `bakin_exec_assets_get` — returns sidecar only.

### Update contents in place

- User/agent edits `store/{YYYY-MM}/{filename}` directly.
- Watcher fires `change` → search reindex.
- Optional: if sidecar has `versioned: true`, old bytes get copied to `archive/{filename}/{sha256}.{ext}` before overwrite (phase 2).

### Retype

```typescript
// plugins/assets/lib/retype.ts — new body
export function retypeAsset({ filename, newType }): RetypeResult {
  const sidecarPath = pathForFilename(filename) + '.meta.json'
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
  sidecar.type = newType
  sidecar.updatedAt = new Date().toISOString()
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2))
  return { ok: true, filename, newType }
}
```

Zero file moves. Zero reference updates. Watcher picks up sidecar change, reindexes search with new `asset_type` facet.

### Relink (change taskId)

Identical to retype but edits `sidecar.taskId`. Zero moves.

### Rename (two forms)

**Relabel** (99% of cases): edit `sidecar.label`. Disk filename unchanged. UI displays label everywhere.

**True canonical rename** (deferred to phase 2, opt-in):
1. Generate new canonical filename from new label.
2. Move file: `store/{old-YYYY-MM}/{oldfn}` → `store/{new-YYYY-MM}/{newfn}` (or same dir if date unchanged).
3. Append to `sidecar.previousFilenames: [oldfn, ...]`.
4. Append to alias table: `oldfn → newfn`.
5. Anywhere `pathForFilename(x)` is called, check alias table first; if hit, resolve via the current filename.

Alias table: small JSON at `~/.bakin/assets/aliases.json`. Only grows on explicit user rename. Not needed for v1.

### Delete (soft)

- Move file + sidecar to `store/.trash/{filename}{.meta.json}`.
- Record `deletedAt` in sidecar.
- Search index removes doc.
- 30-day auto-purge.

### Manual drop (inbox flow)

1. User drops `cool-picture.jpg` into `~/.bakin/assets/inbox/images/`.
2. Watcher fires `add` on inbox path.
3. Inbox ingester:
   - Parses type hint from subdir (`inbox/images/` → `type: "images"`).
   - Generates canonical filename: `{today}-cool-picture-{id8}.jpg`.
   - Moves file to `store/{YYYY-MM}/{filename}`.
   - Writes stub sidecar: `{ agent: "user", source: "manual", type: "images", taskId: null, description: "" }`.
   - Logs audit event.
4. User can later refine sidecar via UI (edit description, tags, taskId, type).

No type-hint subdir? Drop into `inbox/` root → sidecar gets `type: "other"` as default.

## Versioning (phase 2, deferred)

Not blocking for v1. Design sketch for future:

- Opt-in per-asset via `sidecar.versioned: true`.
- On update-in-place or `bakin_exec_assets_new_version` tool call:
  - Copy current bytes to `archive/{filename}/{sha256}.{ext}`.
  - Append to `sidecar.versions[]` with version number, timestamp, sha256.
  - Write new bytes to canonical path.
- Content-addressable: identical bytes dedup automatically (same sha256 filename).
- Revert: swap current with archived version.

v1 ships without versioning. Sidecar schema is already forward-compatible (unknown fields preserved).

## What the Sidecar Looks Like

```json
{
  "filename": "20260401-q2-hero-a1b2c3d4.png",
  "type": "images",
  "taskId": "task-123",
  "agent": "pixel",
  "tool": "nano-banana-pro",
  "description": "Q2 hero image for blog",
  "label": "Q2 Hero",
  "tags": ["hero", "blog", "q2"],
  "source": "agent",
  "createdAt": "2026-04-01T12:00:00Z",
  "updatedAt": "2026-04-05T15:30:00Z",
  "sha256": "..."
}
```

Fields deferred / optional:
- `versioned` (bool, phase 2)
- `versions` (array, phase 2)
- `previousFilenames` (array, phase 2 — rename support)

## What Dies

**Code deletions:**
- `plugins/assets/lib/resolver.ts` — filename → path map, replaced by `pathForFilename()`.
- Any `filenameIndex`-specific logic introduced by Commits A–E.
- `retypeAsset` physical-move code path.
- `relinkAsset` physical-move code path.
- Asset-index logic that tracked `{type}/{taskId}/` structure.
- Migration script (after it runs).

**Layout removals:**
- `assets/images/`, `assets/text/`, `assets/research/`, … (all type dirs).
- `assets/{type}/{taskId}/` structure.

## Migration

One-time script, single user, no backwards compat. Scope:

1. Walk `~/.bakin/assets/{type}/{taskId}/*` (all files except `.trash/`).
2. For each asset file:
   - Parse its sidecar to extract `type` and `taskId`.
   - If filename is already canonical (`YYYYMMDD-slug-id8.ext`), keep it. Otherwise generate one.
   - Determine target: `store/{YYYY-MM}/{filename}` (YYYY-MM from filename's date prefix, or sidecar's `createdAt`, or file mtime as fallback).
   - Move file + sidecar to target.
   - Update sidecar to ensure `type` and `taskId` are present (they were in the path, now in metadata).
3. Migrate `.trash/` contents similarly to `store/.trash/`.
4. Delete empty `{type}/` and `{type}/{taskId}/` dirs.
5. Rebuild the in-memory asset index and search index once.
6. Print summary: N files moved, M sidecars updated, K orphans skipped.

Flags: `--dry-run`, `--apply`, `--backup-dir=<path>`. Run with backup, dry-run first, then apply.

## Testing Strategy

Every test touching storage MUST continue to mock `getContentDir()` to a temp dir (per CLAUDE.md). Additional rules for this rewrite:

- Unit test `pathForFilename()` exhaustively: valid canonical names, missing prefix, malformed date, non-ascii chars, extension edge cases.
- Retype/relink tests assert zero fs moves, only sidecar edits.
- Migration script test: seed a temp dir with the old layout, run `--apply`, assert new layout.
- Inbox ingestion test: drop file into inbox temp dir, assert it lands in store with canonical name + stub sidecar.
- Regression test: write a project manifest referencing a filename, then retype the asset, re-read the manifest — confirm the reference still resolves.

## Boundaries

**Always do:**
- Treat filename as identity.
- Use `pathForFilename()` for all filename-to-path resolution.
- Keep sidecars colocated with files.
- Write sidecars atomically (temp + rename) to avoid partial reads.

**Ask first:**
- Adding fields to the sidecar schema.
- Changing the canonical filename format.
- Any operation that renames a file on disk (rename is phase 2).

**Never:**
- Store paths as external references. Only filenames.
- Move files on retype/relink — that's the whole point of the redesign.
- Rename files via Finder — the system treats it as delete+add and old refs break.
- Re-introduce a filename→path lookup table. Path is a pure function.

## Out of scope (for now)

- True canonical rename (phase 2).
- Versioning (phase 2).
- Git integration for sidecars (future nice-to-have).
- Regenerable `by-type/` symlink views for Finder browsing (future; add when useful).
