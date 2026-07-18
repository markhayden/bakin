# Bakin UI Style Guide (migration-era reference)

The decided visual + interaction system, distilled from the chat overhaul
(2026-07), the brands UX pass, and the design-system foundation. This file
records migration guidance and decisions until the complete system replaces
its preliminary rules. Sister docs: `ui-patterns.md` (gotchas + war stories),
`repo-architecture.md`.

The authoritative executable reference is the public SDK-only Storybook at
`/docs/ui/`; curated plugin-author guidance begins at
`/docs/extending/ui/overview/`. The local maintainer Storybook may also contain
explicitly internal migration stories, which are not SDK contracts. Routing is
owned by `.claude/specs/routing-overhaul.md` and
`.claude/knowledge/url-state-deep-linking.md`; UI migrations consume that
taxonomy rather than inventing a parallel navigation model.

Rule zero: **assemble from the SDK first**. If a pattern below has a named
component, hand-rolling it is a defect, not a preference.

## Approved foundation

Product Character is the approved default as of 2026-07-18. Product and
plugin chrome use locally bundled **Space Grotesk**; identifiers, code,
numerals, and technical data use locally bundled **JetBrains Mono**. The warm
dark foundation, green primary action, pink signal, and yellow highlight keep
their roles through namespaced semantic tokens.

There is one compact-professional density. Product Character spacing governs
pages, sections, controls, and normal content. Tables, repeated rows, and
operational data use the approved tighter dense gap and row height. This is a
contextual recipe inside the same system—not a selectable density mode, a
second theme, or an Inter-based alternative.

The side-by-side Storybook specimens remain internal decision evidence.
Operational Neutral is not an implementation target. New component work uses
the selected Product Character values generated from
`packages/ui/tokens/*.tokens.json`.

## 1. Text hierarchy — four tiers, never adjacent at the same weight

| Tier | Treatment | Examples |
|---|---|---|
| Title | `text-sm font-medium` (+ icon `size-4 text-muted-foreground`) | SectionCard titles |
| Caption / chrome | `text-xs text-muted-foreground/80`, width-capped (`max-w-3xl`) | SectionCard descriptions — "why this matters" one-liners |
| Body / content | `text-sm` (or `text-xs` in dense cards), full contrast | user notes, doc rows, rule text |
| Machine detail | `font-mono text-[10px] text-muted-foreground/60`, **hover-reveal or demoted** | asset ids, slugs, commits |

The busy-page failure mode is tiers 2–4 rendering alike. Our explanations are
chrome and must recede; the user's content is the only body text. Machine ids
never sit at rest in a card — surface on hover or behind the detail view.

## 2. Color semantics — tokens only

- **No hardcoded palettes** (`zinc-*`, hex, `amber-*`); theme tokens only.
  Brand-OWNED colors (palette swatches, cover tints) are data, not styling —
  inline `style` from manifest values is correct there.
- **Neutral chrome**: hover `hover:bg-foreground/10` (buttons) /
  `hover:bg-foreground/5` (rows); selection `bg-foreground/10`. The accent
  (pink) is SIGNAL ONLY: unread pills, working indicators — never hover or
  selection.
- **Status tones** are the `StatusBadge` scale and nothing else:
  `neutral` (queued/imported) · `success` (published/ready) · `warning`
  (draft/attention/working) · `destructive` (blocked/failed) · `accent`
  (unread/special signal). One tone scale for every "what state is this in"
  chip.
- Warning tokens (`bg-warning/10 ring-warning/20`) for attention banners
  (draft banner); destructive tokens for danger surfaces.

## 3. Surfaces & elevation

- Page hierarchy comes first from type, spacing, surface shifts, and subtle
  dividers. Cards are reserved for genuinely bounded objects and coherent
  grouped data; nested card stacks are a defect.
- Approved radii and overlay elevation come from semantic tokens. Do not
  choose `rounded-*` or shadow utilities ad hoc.
- Repeated rows use separators or a restrained surface shift. Explicit dense
  data rows use the canonical dense gap/height without changing typography.
- `SectionCard` is THE titled section: icon + title, caption description,
  right-aligned header `action`. Every user-facing section explains itself in
  one caption line.

## 4. Controls & actions

- ONE primary action per header, right-aligned (`PluginHeader actions`,
  SectionCard `action`). Never stack competing primaries (the three-publish-
  buttons bug).
- Add-row actions live right-aligned in the section header ("+ Add color"),
  not stuffed left under content.
- Destructive row actions are the trash ICON (with `aria-label` + `title`),
  right edge of the row/card — text labels like "Remove group" are noise.
- Hover-reveal actions float in a **reserved gutter** (`pr-9` on the content
  column) — content never sits where a control will appear, and idle rows
  never reserve visible empty blocks.
- Disabled controls explain themselves (tooltip: why + what unblocks).
- Tooltips are Base UI: `TooltipTrigger render={<el/>}` inside
  `TooltipProvider delay={200}` — never Radix `asChild`.

## 5. Save & dirty state

- Manifest-like page data: ONE staged draft + `SaveBar` (dirty dot →
  Save/Discard → explicit "Saved ✓" flash). No blur-to-save, no per-section
  save buttons, never parallel save paths.
- Long-form docs: dedicated editor route with its own `SaveBar`.
- Guard rails for staged drafts (all four, always): key the component by the
  route param; freshness-gate whole-record PUTs; clear the draft by
  snapshot-compare; wire `useUnsavedChangesGuard`.
- Cross-domain writes (e.g. asset notes from a brand page) stay immediate —
  they're not part of this page's draft.

## 6. Confirmation & destruction

- `ConfirmDialog` is the ONE confirm engine (busy/error-aware; optional
  `confirmValue` typed confirmation).
- Reference-removal confirms say the honest thing ("the file stays in your
  asset library; takes effect when you save").
- Irreversible entity deletion = `DangerZone`: red-bordered, consequences
  spelled out, type-the-id-to-confirm, at the very BOTTOM of Settings.
- Light confirms for high-consequence flips (publish/unpublish) that name
  what changes.

## 7. Navigation & routing

- Detail surfaces are path routes (`/thing/$id`), tabs/filters are URL query
  state (`useQueryState` — CLAUDE.md mandate; search filters included).
- Back is `useHistoryBack(fallback)` + icon-only arrow. Exception: after
  DELETING the thing, navigate to the list explicitly.
- Deep-linkable editors follow the workflows-edit precedent: route wrapper
  passes params + onSaved/back callbacks into the slot component.
- TanStack search params are JSON-parsed (`?x=1` → number) — String()-coerce.

## 8. Empty, loading, error

- A blank pane is a bug. Route-level: skeletons shaped like the layout.
- Section-level empties: centered, breathing (`SectionEmpty` shape: min-h,
  soft `bg-foreground/[0.03]` container, centered caption) — never a muted
  sentence blended into section copy. Teach by example ("e.g. product-ui …").
- First-run empty states ARE the create flow (empty list = inline chooser).
- Errors are honest and distinct from absence: transient failure = retryable
  `ErrorState` ("probably fine — retry"), 404 = "doesn't exist" — never
  conflate (a false "deleted" baits destructive recreation).

## 9. Feedback & liveness

- Every mutation confirms visibly: `toast` (success/info/error) or the
  SaveBar's Saved flash. Silent success reads as failure.
- Background agent work is NEVER invisible: banner with live board status
  (Queued / Agent working / Draft ready / Blocked via `taskboard` SSE), a
  link to the task, and surfaces that refresh on the domain's `*.changed`
  plugin event so content fills in live.
- Refresh AFTER your own write lands (synthetic event), never off the event
  that precedes the write.

## 10. Cards & media

- Content with imagery leads with the image. Reference-media cards are
  HORIZONTAL: fixed square thumbnail left (`w-36`), text right with the
  width, 2-across stretch grid. Note clamps (2–3 lines); id is hover-reveal.
- Long text previews fade into a SOLID overlay (opaque base ~45%) carrying a
  summary + real CTA button (`FadeMore` shape) — never a trailing ghost of
  masked text, never a full dump beside a faded sibling.
- Logo-less identity fallback: initials monogram on a tinted disc (the
  AgentAvatar convention).

## 11. Composition

- One engine per domain; components are thin. Chat-like surfaces compose the
  conversation kit; embedded agent help = `ConversationPanel` +
  `useConversationStream` over a per-request SSE plugin route
  (chunk/done/error frames), `ephemeral: true`, reply-in-chat-only prompts.
- Cross-plugin data flows through hooks/REST, never imports.
- `data-*` test hooks on every meaningful element; tests assert behavior,
  not styling classes.

## 12. Pattern census (2026-07) — status + backlog

Full census ran across `src/components/` + all plugin `components/`. First
wave landed in the brands-ux-cleanup branch; the rest is the backlog for the
full style-guide pass.

**Done in the first wave:**
- `SegmentedControl` promoted; adopted at all 5 hand-rolled sites (brands
  doc editor, schedule view switcher, kanban Board|Log, health ×2 windows).
  Note: schedule/kanban deliberately lost their accent-active styling —
  selection is neutral, accent is signal.
- `StatTile` promoted (from brands, with a `progress` slot); brands adopted.
- `EmptyState` gained `variant="section"` (from brands' SectionEmpty);
  `title` widened to ReactNode.
- `StatusBadge` gained `variant="outline"`; schedule job-row's four ad-hoc
  state chips adopted (its local wrapper renamed `JobStatusBadge`).
- `useFileDrop` promoted (headless drag-drop intake); AssetPicker + brands
  LogoDrop/MaterialsDrop adopted.
- `useHistoryBack` adopted by team agent-detail + team-detail back buttons.
- SDK `markdown-editor.tsx` de-zinc'd (was leaking off-token color into
  every consumer).

**Backlog (full style-guide pass):**
1. **Token migration** — ~517 hardcoded palette classes across ~70 plugin
   files. Worst: tasks/task-workflow-panels (39), tasks/task-card (37),
   workflows/step-detail-drawer (32) + nodes/* family, team/team-grid (25,
   incl. hex), schedule/calendar-weekly,
   assets/VersionedAssetGrid. Workflow node-kind colors deserve a shared
   semantic token map, not inline literals. Also: AgentAvatar status-dot
   colors, models/brand-icon `#475569`, workflow-canvas `#525252` edges.
2. **StatTile adoption sweep** — tasks/task-metrics `Stat`, team/overview
   tiles, memory/tier-overview-cards, models/spend-tab, health metric
   readouts, schedule calendar count tiles.
3. **SaveBar adoption** — `PluginSettingsRenderer` (SDK itself), models
   routing-tab + spend-tab staged saves, tasks/task-detail-modes inline
   Save. Single-submit forms (job-form, agent-form) are a different
   pattern — leave.
4. **EmptyState section-variant sweep** — ~12 hand-rolled muted `<p>` empty
   one-liners (schedule/run-history, tasks/task-notes-section,
   chat/launcher, team/team-detail + overview-tab, assets/TagFolderGrid,
   workflows-page custom empty prop, brands/task-brand-panel + brand-card).
5. **StatusBadge sweep** — health/plugins-section strips,
   team/package-card, team/package-state-badge (whole local component
   overlaps StatusBadge).
6. **Hover-reveal a11y** — ~7 sites missing `focus-visible:opacity-100`
   (keyboard users can't reach the action): tasks/task-card,
   schedule/job-row, chat/chat-rail, team/agent-detail, assets ×3. Consider
   a shared `revealOnHover` util or `HoverActions` wrapper.
7. **package-card remove Dialog** — adopt ConfirmDialog if reducible to one
   confirm action.
8. Deliberate one-offs (do NOT unify): FadeMore (single consumer),
   monogram/avatar fallbacks (distinct entities), workflow-canvas node drop
   (canvas, not file intake), form/wizard Dialogs.

## 13. Health-derived operator patterns (2026-07)

The action-first Health pass established patterns to reuse in other diagnostic
and administrative surfaces during the full style-guide sweep:

- **Lead with the decision.** Overall state and actionable exceptions precede
  inventories. Healthy inventory belongs in collapsed/detail surfaces; unknown
  state is explicit and never styled as success.
- **Separate evidence from live facts.** Slow diagnostic evidence carries
  checked/observed/stale times and last-known labeling. Fast counts say "right
  now" and never silently override the evidence-based state.
- **Stable identity, expandable detail.** The calm row leads with title,
  impact, affected resources, freshness, and one contextual action. Machine
  evidence lives in a disclosure and focus keys to stable incident IDs, not
  message text.
- **Mutation means plan, consent, verify.** Diagnostics do not mutate. Repair
  dialogs show concrete changes and safety, preselect safe items only, confirm
  every non-safe item, reject stale plans, and distinguish applied from
  verified. Only explicit user actions announce in the polite live region.
- **Charts are summaries, not locked boxes.** Focus and hover expose the same
  mark label; an always-present table/disclosure exposes every exact value.
  Empty charts stay honest and reduced motion removes animation.
- **Container responsiveness is the contract.** Named containers drive card,
  control, and table layout. Headers wrap; essential state never truncates;
  dense raw tables scroll inside their own card. Verify at 1024/720/480/320,
  including the surrounding shell.
- **Only mounted views poll.** URL-backed tabs mount only the selected panel.
  Resource hooks cancel superseded requests, retain last good data after a
  background failure, and distinguish initial error, refreshing, and stale.
