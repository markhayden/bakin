# SPEC: Assets Plugin — Retype, Inline Edit, and MCP Guidance

_Created: 2026-04-15 | Owner: Mark_

---

## Objective

Extend the assets plugin so users and agents can:
1. **Retype assets** — change an asset's categorization (type) from the detail overlay, with Antfly auto-reindex on save
2. **"Research" asset type** — add a new first-class asset type for research materials
3. **MCP guidance** — improve agent-facing tool descriptions so agents understand how to categorize and organize content
4. **Inline editing** — edit text/markup asset content directly in the detail overlay (toggle display to editor, save)
5. **Shared `MarkdownEditor` component** — extract the read/edit toggle pattern into a reusable component used across plugins

Single user, single machine. No backwards-compat shims needed.

---

## 1. Retype Assets

### Current State

Asset type is determined by file extension via `EXTENSION_TO_TYPE` in `plugins/assets/lib/constants.ts` and encoded physically in the filesystem path: `assets/{type}/{taskId}/{filename}`. There is no UI or API to change type after creation. The only physical move operation today is `relinkAsset()` in `plugins/assets/lib/relink.ts`, which moves between task directories within the same type.

### Design

**New function: `retypeAsset()`** in `plugins/assets/lib/retype.ts`

Modeled after `relinkAsset()` — physically moves the file (+ sidecar + variants) from `assets/{oldType}/{taskId}/...` to `assets/{newType}/{taskId}/...`. Same collision-handling, same variant detection, same sidecar update pattern.

```typescript
interface RetypeParams {
  assetPath: string   // relative to content dir
  newType: AssetType  // target type
}

interface RetypeResult {
  ok: boolean
  oldPath: string
  newPath?: string
  error?: string
}
```

**New route: `PATCH /retype`** on the assets plugin router

```
PATCH /api/plugins/assets/retype
Body: { path: string, type: AssetType }
Returns: { ok: boolean, oldPath: string, newPath: string }
```

Triggers: `ctx.search.remove(oldPath)` + `indexAsset(newPath)` for Antfly sync. Emits `asset.retyped` audit event. Updates in-memory index.

**New MCP tool: `bakin_exec_assets_retype`**

Parameters: `path` (asset path), `type` (target AssetType). Same handler pattern as `bakin_exec_assets_link`.

**UI: Type selector in detail overlay sidebar**

Replace the static `<Badge variant="outline">{asset.type}</Badge>` in the dialog header (`asset-detail.tsx`) with an inline `<Select>` dropdown populated with `ASSET_TYPES`. When changed:
1. Set optimistic `localAsset` to keep dialog open during the file move
2. Call `PATCH /retype` with new type
3. On success, call `onPathChange?.(newPath)` to update the parent's `?asset=` URL param (prevents SSE refetch from closing the dialog when the old path disappears)
4. Fetch fresh asset data from the new path and update `localAsset`
5. The watcher handles Antfly reindex as safety net

### Acceptance Criteria

- [ ] Changing type in the overlay moves the file to the new type directory
- [ ] Sidecar, thumbnail, and optimized variants move with the primary file
- [ ] Antfly search index updates to reflect new `asset_type`
- [ ] File watcher picks up the move (old unlink + new sync) as safety net
- [ ] In-memory asset index (`asset-index.ts`) updates correctly
- [ ] Agents can retype via `bakin_exec_assets_retype` MCP tool
- [ ] Collision handling works (same filename exists in target directory)

---

## 2. "Research" and "PDF" Asset Types

### Current State

Seven types: `text`, `images`, `video`, `audio`, `plans`, `data`, `other`. `.pdf` mapped to `other`.

### Design

Add `'research'` and `'pdf'` to `ASSET_TYPES` in `constants.ts`. Final order: `text, images, video, audio, plans, research, pdf, data, other` (9 types).

- **research** — No extension mappings. Always a manual categorization (via retype in UI or explicit `type: 'research'` in MCP save tool). Semantic category for analysis, reference docs, competitive intel.
- **pdf** — `.pdf` extension auto-maps to `pdf` (previously mapped to `other`). PDF content is extractable for search indexing but not editable via `PUT /content`.

**Files to update:**
- `plugins/assets/lib/constants.ts` — add to `ASSET_TYPES` array
- `src/types/index.ts` — add `'research'` and `'pdf'` to `AssetMeta.type` union literal
- `plugins/assets/components/asset-detail.tsx` — `AssetRenderer` switch: `research` falls through to `TextRenderer` like `text` and `plans`
- `.claude/knowledge/assets-plugin.md` — document the new type

The `reindex()` generator already iterates `ASSET_TYPES`, the search schema already indexes `asset_type` as a keyword field, and the UI filter already reads from the type list — all pick up the new type automatically.

### Acceptance Criteria

- [ ] `research` appears in type facet filter on the assets page
- [ ] `research` appears in the retype dropdown
- [ ] `~/.bakin/assets/research/` directory created on first retype or save
- [ ] MCP save tool accepts `type: 'research'`
- [ ] Assets grid renders research assets (falls through to text renderer)
- [ ] Search indexes research assets correctly

---

## 3. MCP Tool Guidance

### Current State

`bakin_exec_assets_save` parameter descriptions are minimal. The `type` field says: _"Asset type: text, images, video, audio, plans, data, or other"_ — no guidance on when to pick which. No guidance on descriptions, tags, or organization. There is no update-metadata MCP tool.

### Design

Improve tool descriptions with actionable categorization guidance:

**`bakin_exec_assets_save`** — Expand the `type` parameter `.describe()`:
```
Asset type — determines how the asset is organized and displayed:
- text: Written content — articles, summaries, copy, notes
- research: Research materials, analysis, reference docs, competitive intel
- plans: Strategic plans, roadmaps, workflows, project specs
- images: Visual assets — photos, illustrations, graphics
- video: Video files — walkthroughs, demos, reels
- audio: Audio files — podcasts, recordings, music
- pdf: PDF documents — reports, whitepapers, manuals
- data: Structured data — JSON, CSV, XML exports
- other: Anything that doesn't fit above

When unsure: if it informs future decisions, use research. If it's a deliverable, use text. If it describes what to do, use plans.
```

Also enhance `description` and `tags` parameter descriptions:
- **description**: `"One-sentence summary visible in the asset grid and search. Be specific — 'Q2 blog hero image' not 'an image'."`
- **tags**: `"Lowercase hyphenated tags for filtering. Use domain tags (social, blog), format tags (draft, final), and project tags."`

**`bakin_exec_assets_retype`** (new tool) — Include the same rubric in its description so agents choosing a new type have guidance inline.

### Acceptance Criteria

- [ ] All asset MCP tool descriptions are clear and actionable
- [ ] Type parameter includes the categorization rubric with all 8 types
- [ ] Tags and description parameters include formatting guidance

---

## 4. Inline Content Editing

### Current State

The detail overlay renders text/markdown via `TextRenderer` (read-only `<MarkdownContent>` or `<pre>`) and structured data via `CodeRenderer` (read-only `<pre>`). No edit capability exists. There is no REST route to update asset file content.

### Design

**New route: `PUT /content`** on the assets plugin router

```
PUT /api/plugins/assets/content
Body: { path: string, content: string }
Returns: { ok: boolean, size: number }
```

Writes content to the asset file on disk. Only allowed for editable MIME types. Binary types (images, video, audio, PDF) return 400.

Validation:
- Path must start with `assets/`, no `..` traversal
- File must exist on disk
- MIME type must be in the editable set
- Content is a string (no binary)

The file watcher picks up the change → triggers `onSync` → re-indexes in Antfly automatically.

**New MCP tool: `bakin_exec_assets_update_content`**

Parameters: `path` (asset path), `content` (new file content). Same MIME type restrictions.

**Editable MIME types** (aligned with `content-extractor.ts` `PLAIN_TEXT_EXTS`):

```typescript
const EDITABLE_MIMES = new Set([
  'text/markdown',
  'text/plain',
  'application/rtf',
  'text/yaml',
  'application/yaml',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
  'application/xml',
])
```

Expose as `isEditableMimeType(mime: string): boolean` from `plugins/assets/lib/constants.ts` for use in both server routes and client-side rendering logic.

**UI: Edit mode in detail overlay**

Add an "Edit" button in the detail overlay header (next to the filename). Only visible when `isEditableMimeType(asset.mimeType)` is true.

When clicked:
1. The content pane swaps from `TextRenderer`/`CodeRenderer` to `MarkdownEditor` (section 5) in edit mode
2. User edits the raw content (markdown source, YAML, JSON, plain text)
3. "Save" button in the header writes via `PUT /content`
4. On success, toggle back to read mode with updated content
5. "Cancel" discards changes, returns to read mode

The format prop on `MarkdownEditor` is derived from MIME type:
- `text/markdown` → `'markdown'`
- `text/yaml` / `application/yaml` → `'yaml'`
- `application/json` → `'json'`
- Everything else → `'text'`

### Acceptance Criteria

- [ ] Edit button appears only for text-editable asset types
- [ ] Clicking Edit toggles the content pane to a textarea with current content
- [ ] Save writes to disk via `PUT /content` and returns to read mode
- [ ] Cancel discards changes and returns to read mode
- [ ] File watcher picks up the change and Antfly reindexes
- [ ] Content round-trips cleanly (no whitespace corruption, encoding preserved)
- [ ] MCP tool `bakin_exec_assets_update_content` works for agent-driven content updates

---

## 5. Shared `MarkdownEditor` Component

### Current State

`ProjectEditor` (`plugins/projects/components/project-editor.tsx`) implements a textarea-to-markdown toggle pattern but lives inside the projects plugin. Multiple plugins use raw `<textarea>` without a shared component. There is no shared edit component in `src/components/`.

### Design

**New component: `src/components/markdown-editor.tsx`**

```typescript
interface MarkdownEditorProps {
  content: string
  editing: boolean
  onChange: (content: string) => void
  placeholder?: string
  format?: 'markdown' | 'yaml' | 'json' | 'text'
  minHeight?: string  // CSS value, default '320px'
  className?: string
}
```

- **Read mode (`editing=false`)**: Renders via `<MarkdownContent>` for `markdown` format, `<pre className="font-mono ...">` with syntax-appropriate formatting for yaml/json/text
- **Edit mode (`editing=true`)**: shadcn `<Textarea>` with monospace font, auto-resize via `field-sizing-content`
- Parent component owns the edit/read toggle state — `MarkdownEditor` is a controlled component
- Empty state: shows placeholder text in muted color

**Refactor `ProjectEditor`** to wrap `MarkdownEditor`:

```typescript
export function ProjectEditor({ body, editing, onChange }: EditorProps) {
  return (
    <MarkdownEditor
      content={body}
      editing={editing}
      onChange={onChange}
      placeholder="Project details, goals, background..."
      format="markdown"
    />
  )
}
```

This preserves the existing API surface for the project detail page while using the shared component internally.

**Asset detail overlay** uses `MarkdownEditor` directly with the appropriate `format` prop.

### Acceptance Criteria

- [ ] `MarkdownEditor` handles markdown, yaml, json, and plain text formats
- [ ] `ProjectEditor` refactored to use `MarkdownEditor` — same visual behavior
- [ ] Asset detail inline edit uses `MarkdownEditor`
- [ ] No visual regression in project editor
- [ ] Component is importable from `@/components/markdown-editor`

---

## Non-Goals / Out of Scope

- Rich text (WYSIWYG) editing — textarea for raw markup is sufficient
- Editing binary assets (images, video, audio, PDF)
- Bulk retype operations
- Auto-categorization via AI
- Description/tags inline editing in the detail overlay (future work)
- A general-purpose PATCH route for sidecar metadata (just retype and content for now)

---

## Tech Stack & Constraints

- **No new dependencies** — `react-markdown` (already installed) + shadcn `<Textarea>` + shadcn `<Select>`
- **File moves** for retype — not symlinks, not metadata-only. Type is embedded in the physical path.
- **Antfly reindex** happens through existing watcher path (move = unlink old + sync new) with explicit REST-level calls as the primary synchronous path
- **Tests must mock `getContentDir()`** per CLAUDE.md testing rules
- **Single user** — no optimistic locking needed for concurrent edits

---

## File Impact Summary

### New Files

| File | Purpose |
|------|---------|
| `src/components/markdown-editor.tsx` | Shared read/edit toggle component |
| `plugins/assets/lib/retype.ts` | `retypeAsset()` — physical type change with file move |
| `plugins/assets/routes/retype.ts` | `PATCH /retype` route handler |
| `plugins/assets/routes/content.ts` | `PUT /content` route handler |

### Modified Files

| File | Change |
|------|--------|
| `plugins/assets/lib/constants.ts` | Add `'research'` and `'pdf'` to `ASSET_TYPES`, map `.pdf` → `pdf`, add `isEditableMimeType()` |
| `src/types/index.ts` | Add `'research'` and `'pdf'` to `AssetMeta.type` union |
| `packages/core/src/content-dir.ts` | Add `'assets.research'` and `'assets.pdf'` to `BakinPaths`, `getBakinPaths()`, `initBakinHome()` |
| `plugins/assets/lib/save-asset.ts` | Remove duplicate `ASSET_TYPES`, import from `./constants` |
| `plugins/assets/index.ts` | Register new routes, new MCP tools, update tool descriptions with categorization rubric |
| `plugins/assets/components/asset-detail.tsx` | Type `<Select>`, floating edit buttons, `onPathChange` for retype SSE race, `research`/`pdf` in renderer |
| `plugins/assets/components/assets-page.tsx` | Wire `onPathChange={setAssetPath}` to `AssetDetail` |
| `plugins/projects/components/project-editor.tsx` | Refactor to use shared `MarkdownEditor` |
| `.claude/knowledge/assets-plugin.md` | Document new types, routes, tools, and editable types |
