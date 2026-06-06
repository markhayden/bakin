---
title: Assets
description: "Versioned files and their history. One asset, many versions — searchable, linkable, recoverable."
---

Your agents are hoarders, in the good way. Every image they ship, every plan they write, every screenshot they grab lands in Assets. You drop in whatever else they should see. And when something gets *revised* — a generated image refined three times, a doc re-saved as it evolves — it stays **one asset with a version history**, not a pile of near-duplicates. Indexed across text and pixels, so the catalog gets sharper every time someone touches it.

## The library

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-assets--library.webp" alt="The assets library: one card per asset, with a version-count badge on assets that have history." loading="lazy">
</figure>

The library shows **one card per asset**. An asset that has been revised shows a `v3 · 3 versions` badge in the corner; the card always renders the *current* version. Click any card to open its [detail page](#the-detail-page) — preview, full version history, and exports. Hover a card (or list row) for a pencil that opens the [edit drawer](#editing-metadata-and-tags).

Four views, all URL-backed: **Grid** (tiles, never narrower than 250px), **List**, **Folders**, and **Trash**. Filter by **Type** or **Tags** (an *Untagged* option keeps tagless assets reachable); filters deep-link via `?type=` / `?tags=`.

### Folders (tags as organization)

Tags double as folders. The **Folders** view groups the library by tag — each folder card shows a collage of its most recent assets and a count; an asset with three tags appears in all three folders. Clicking a folder lands you in the grid filtered to that tag, with a `Folders / <tag>` breadcrumb back. From a folder's `⋮` menu you can **Rename** the tag across every asset that carries it (merging if the target name exists) or **Delete** it everywhere (the assets themselves are untouched). Folders sort by their most recently updated asset; *Untagged* is pinned first.

### Editing metadata and tags

The edit drawer (hover pencil on any card or row, or **Edit** on the detail page) edits an asset's **description** and **tags**. Tags normalize on save (`Hello World` → `hello-world`) and the input suggests existing tags so near-duplicate folders don't accumulate. To tag many assets at once, hit **Select** in grid or list view, click assets to select them, and use the floating bar to apply tags to the whole selection.

Tags are **asset-level organization** — they survive agent edits, new versions, and promotes. Descriptions ride with versions: editing one updates the current version, and promoting an older version restores *its* description.

Search is semantic and reaches text and pixels at the same time. Type "italian food" and you'll get recipes for carbonara, photos of pasta the visual index spotted on sight, research notes on regional cooking, video clips of pizza-making. None of those need to literally say "italian" to surface. One query, the whole library. Search indexes the **current version** of each asset.

## What can be an asset

Bakin classifies files by extension into nine types:

<div class="table-light-fit table-label">

| Type | Extensions |
| --- | --- |
| `text` | `.md` `.txt` `.rtf` |
| `images` | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.bmp` `.ico` |
| `video` | `.mp4` `.mov` `.webm` `.avi` `.mkv` |
| `audio` | `.mp3` `.wav` `.m4a` `.ogg` `.flac` `.aac` |
| `plans` | `.yaml` `.yml` |
| `pdf` | `.pdf` |
| `data` | `.json` `.csv` `.tsv` `.xml` |
| `other` | anything else |
| `research` | retype-only (no auto-classification) |

</div>

`other` is a real type. Files outside the whitelist still upload and get all the same versioning, metadata, indexing, and trash treatment. Default size limit is 50 MB per file, configurable in Settings.

## Creating and versioning assets

Every asset is a **stable id** (`YYYYMMDD-{slug}-{8charId}`) naming a directory that holds its versions. The first save creates `v1`. A *re-save of the same source*, or an *edit*, appends a new version and advances the "current" pointer — it does **not** mint a new asset.

### Drag and drop / inbox / clipboard

- **Drag and drop**: `+ Add` on the assets page or any task. Drop one or many files — each becomes a new asset (v1).
- **Inbox**: `~/.bakin/assets/inbox/` is a watched folder. Drop a file (or into `inbox/{type}/` to hint the type) and Bakin ingests it as a managed asset and indexes it.
- **Clipboard**: paste an image or long text into a task description. Bakin uploads it (source `clipboard`), links it to the task, and writes a reference into the description.

### Saved by an agent

Agents call `bakin_exec_assets_save` with a source file. The key behavior: **re-saving the same source path versions the existing asset** (or no-ops if the content is unchanged) instead of creating duplicates. So an agent iterating on a document ends with one asset and a clean `v1 → v2 → v3` history. Image agents likewise generate (`v1`) and edit (`v2`, `v3`) through the [Images plugin](/docs/using/images/) onto a single asset.

## The detail page

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-assets--detail.webp" alt="The asset detail page: current preview, exports, and the version timeline with promote and delete-version actions." loading="lazy">
</figure>

Clicking a card opens `/assets/<assetId>` — the home for everything version-related:

- **Current preview** of the asset, plus its description, agent, task, and tags. The description mirrors the current version (promote restores that version's description); tags are asset-level and never change with versions. **Edit** opens the metadata drawer.
- **Exports**: derived, surface-sized deliverables (e.g. an `open-graph.jpg` cropped from a chosen version). Exports are *not* versions — they're published artifacts that download directly.
- **Version history**: every version newest-first, each showing its op (generate/edit/upload), prompt, and provenance (provider · model · route · surface). Two actions per version:
  - **Make current** — promote any older version back to current. No files change; the card, search, and default export source all follow the pointer.
  - **Delete** — remove a single version. Numbers stay stable (deleting `v2` leaves `[v1, v3]`); deleting the *current* version auto-falls-back to the latest remaining.
- **Delete asset** — trashes the whole asset (all versions). The dialog defaults to "whole asset" but offers "just the current version" when more than one exists.

Editing a text asset's content saves a **new version** — the history captures the edit, nothing is overwritten in place.

## Where they live

```
~/.bakin/assets/
  store/
    YYYY-MM/                                   # month shard (from the assetId date)
      20260401-hero-a1b2c3d4/                  # the asset (a directory)
        manifest.json                          # sole source of truth: versions[] + exports[]
        v1.png  v1.thumb.jpg                   # version 1 + thumbnail
        v2.png  v2.thumb.jpg
        v3.png  v3.thumb.jpg                   # current (pointer lives in manifest.json)
        exports/
          open-graph.jpg                       # a derived export (from a version)
  inbox/                                       # ingestion staging
  .trash/                                      # soft-deleted assets (whole directories)
```

The `manifest.json` is the single source of truth — there are no per-file sidecars. It holds asset-level metadata (`type`, `agent`, `taskId`, `currentVersion`, the mirrored `description`, and the asset-level `tags`) plus the full `versions[]` and `exports[]`. Writes are atomic; mutations are serialized per asset.

## Addressing

Assets are addressed by **id**, not filename:

```
GET /api/assets/<assetId>                # current version bytes
GET /api/assets/<assetId>/v/<n>          # a specific version
GET /api/assets/<assetId>/thumb          # current thumbnail
GET /api/assets/<assetId>/export/<name>  # a derived export
```

ETags are keyed on `assetId:currentVersion`, so promoting or editing busts the browser cache automatically.

## Indexing and search

Assets register with the search system as a file-backed content type, table `bakin_assets` — **one row per asset, keyed by `assetId`**, built from the current version. The `manifest.json` is both the indexed unit and the reindex trigger: any mutation rewrites it and re-indexes that one row. Indexed across two Antfly indexes:

- **Text**: description, tags, generation surface (so "instagram" finds `instagram-feed-portrait` images), and extracted content (PDF text, markdown, plain text, JSON, CSV, YAML).
- **Visual** (raster images only): a CLIP embedding of the current version's image.

Facets for filtering: `asset_type`, `agent`, `tool`, `tags_facet`, `provider`, `model` — so "everything made with gpt-image-2" is one facet away. Cross-table search reaches assets, tasks, projects, memory, and everything else in one query. If anything looks stale, reindex from the [Health](/docs/using/health/) page.

## Trash and recovery

Delete soft-deletes the whole asset directory to `~/.bakin/assets/.trash/` with a `__deleted-{timestamp}` suffix, restorable for 7 days by default. `delete-version` is different — it removes a single version in place and never goes to trash. Past the recovery window, asset health checks can purge expired trash through the doctor repair workflow. Restore drops the asset directory back at its canonical path and re-indexes.

## How other plugins use assets

- **Images**: generate/edit/export all run through the asset service — one asset, versioned. See [Images](/docs/using/images/).
- **Tasks**: clipboard paste auto-uploads; each task page renders the `task-assets` slot showing assets linked to that task (and its subtasks).
- **Projects / Messaging**: render asset previews via `/api/assets/<assetId>`.
- **Memory**: listens to asset events so anything that happens to an asset surfaces in your memory tier.

Plugins compose by `assetId` (`/api/assets/<assetId>` is a stable URL) or by slot (`asset-preview`, `asset-detail-modal`, `task-assets`).

## Settings

<!-- docs:settings assets -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Generate thumbnails | `boolean` | `true` | Auto-create optimized thumbnails on upload |
| Max file size (MB) | `number` | `50` | Reject uploads larger than this |
| Purge clipboard assets on task completion | `boolean` | `false` | Auto-delete clipboard-pasted assets when their linked task is marked done |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Most asset workflows happen in the UI or through agents. Trash is CLI-friendly:

<!-- docs:cli-commands assets -->
| Command | Purpose |
| --- | --- |
| `bakin trash [list\|restore\|empty] ...` | Manage trashed assets. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/). HTTP API surface: see the [API reference](/docs/reference/generated/api/#assets).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents create, version, link, and curate assets through MCP exec tools. The headline: **`bakin_exec_assets_save` upserts** — re-saving the same source versions the existing asset instead of duplicating it. (The old `bakin_exec_assets_update_content` tool is gone; saving the updated file is how you revise content now.)

<!-- docs:exec-tools assets -->
- `bakin_exec_assets_audit`: Audit versioned-asset health: manifest integrity, current-pointer resolution, and missing version files.
- `bakin_exec_assets_delete`: Soft-delete a whole asset (all versions) to trash, restorable until trash is emptied.
- `bakin_exec_assets_empty_trash`: Permanently delete all trashed assets. This cannot be undone.
- `bakin_exec_assets_get`: Retrieve an asset manifest (versions, current pointer, exports) by assetId.
- `bakin_exec_assets_link`: Link an asset to a different task, or unlink it (set taskId to null).
- `bakin_exec_assets_list`: List managed assets (one entry per asset, current-version view). Optional type and task filters.
- `bakin_exec_assets_list_trash`: List trashed assets (whole-asset deletions) with deletion time and version count.
- `bakin_exec_assets_open`: Open an asset by assetId: returns its manifest plus the current version’s extracted text for text-like assets.
- `bakin_exec_assets_permanent_delete`: Permanently delete a specific trashed asset. This cannot be undone.
- `bakin_exec_assets_restore`: Restore a trashed asset by its trash name (from bakin_exec_assets_list_trash).
- `bakin_exec_assets_retype`: Change an asset type classification.
- `bakin_exec_assets_save`: Save an agent-created file as a managed, versioned asset. Re-saving the SAME source file appends a new version to the existing asset (or no-ops if unchanged) instead of creating a duplicate — so an evolving doc stays one asset with a version history. Returns the asset id.
<!-- /docs:exec-tools -->

Full schemas and arguments in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Images](/docs/using/images/): generation, editing, and exports run on the versioned asset model
- [Tasks](/docs/using/tasks/): tasks own clipboard pastes and the `task-assets` slot
- [Memory](/docs/using/memory/): asset events feed memory automatically
- [Essentials](/docs/using/essentials/#search): the search index covers every asset's text and image content
