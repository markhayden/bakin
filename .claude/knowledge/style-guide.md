# Bakin Browser UI Style Guide

The decided visual and interaction system for Bakin product UI and plugins.
This file records composition decisions; public Storybook demonstrates them,
and machine-readable design-system ledgers enforce their objective boundaries.
Sister docs: `ui-patterns.md` (gotchas and war stories) and
`repo-architecture.md`.

The authoritative executable reference is the public SDK-only Storybook at
`/docs/ui/`; curated plugin-author guidance begins at
`/docs/extending/ui/overview/`. The local maintainer Storybook may also contain
explicitly internal migration stories, which are not SDK contracts. Routing is
owned by `.claude/specs/routing-overhaul.md` and
`.claude/knowledge/url-state-deep-linking.md`; UI migrations consume that
taxonomy rather than inventing a parallel navigation model.

Rule zero: **assemble from the focused SDK first**. If public Storybook defines
the pattern, hand-rolling it is a defect, not a preference. When no pattern can
satisfy the domain requirement, follow the concrete explanation and explicit
approval protocol in `.claude/skills/bakin-ui-conformance/SKILL.md`; never
silently diverge.

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
| Page identity | `PageHeader` title/eyebrow contract | one page `h1`, domain context |
| Section title and chrome | Canonical section/card headings plus muted description | “why this matters” one-liners |
| Body and user content | Default UI/body typography at full content contrast | notes, document rows, rule text |
| Machine detail | Mono technical/meta typography, **hover-reveal or demoted** | asset ids, slugs, commits |

The busy-page failure mode is tiers 2–4 rendering alike. Our explanations are
chrome and must recede; the user's content is the only body text. Machine ids
never sit at rest in a card — surface on hover or behind the detail view.

## 2. Color semantics — tokens only

- **No hardcoded palettes** (`zinc-*`, hex, `amber-*`); theme tokens only.
  Brand-OWNED colors (palette swatches, cover tints) are data, not styling —
  inline `style` from manifest values is correct there.
- **Neutral chrome**: use the canonical neutral hover and selected treatments
  from SDK components. The accent (pink) is SIGNAL ONLY: unread pills, working
  indicators—never generic hover or selection.
- **Status tones** are the `StatusBadge` scale and nothing else:
  `neutral` (queued/imported) · `success` (published/ready) · `attention`
  (draft/attention/working) · `danger` (blocked/failed) · `accent`
  (unread/special signal). One tone scale for every "what state is this in"
  chip.
- Use `Banner`, `Alert`, and canonical danger patterns for attention and danger
  surfaces; do not restyle status colors locally.

## 3. Surfaces & elevation

- Page hierarchy comes first from type, spacing, surface shifts, and subtle
  dividers. Cards are reserved for genuinely bounded objects and coherent
  grouped data; nested card stacks are a defect.
- Approved radii and overlay elevation come from semantic tokens. Do not
  choose `rounded-*` or shadow utilities ad hoc.
- Repeated rows use separators or a restrained surface shift. Explicit dense
  data rows use the canonical dense gap/height without changing typography.
- `Section` owns page rhythm; canonical cards own bounded-object structure.
  Titled regions pair one heading with a short description and a right-aligned
  action when needed. Every user-facing section explains itself in one caption
  line.

## 4. Controls & actions

- ONE primary action per header, right-aligned (`PageHeader actions` or the
  owning section action). `PageHeader controls` owns compact search and view
  navigation beside it; the reserved search slot must not repack the desktop
  row on focus. `SearchInput` expands on focus, collapses to the controlled
  query width, truncates longer values with an ellipsis, and supplies the
  neutral accessible clear action; do not expose a browser-native search
  cancel control. Never stack competing primaries (the three-publish-buttons
  bug).
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
  snapshot-compare; wire `useUnsavedChangesGuard` from
  `@makinbakin/sdk/navigation`. Do not use the deprecated unload-only
  `useUnsavedGuard`, copy the complete guard, or create a parallel navigation
  engine.
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
  state (`useQueryState` from `@makinbakin/sdk/navigation`; search filters
  included).
- Back is `useHistoryBack(fallback)` from the navigation entrypoint plus an
  icon-only arrow. Exception: after
  DELETING the thing, navigate to the list explicitly.
- Deep-linkable editors follow the workflows-edit precedent: route wrapper
  passes params + onSaved/back callbacks into the slot component.
- Query values are plain strings: `?id=123` stays the string `'123'`. Use the
  navigation entrypoint's query-state hooks and their default omission/batching behavior;
  never add JSON coercion or rebuild query strings locally.

## 8. Empty, loading, error

- A blank pane is a bug. Route-level: skeletons shaped like the layout.
- Section-level empties use the appropriate `SystemState` scope—never a muted
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
  horizontal: a stable square thumbnail, bounded text, and the canonical card
  grid. Note previews clamp; machine ids are hover-reveal or detail content.
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

## 12. Migration tracking and exceptions

Do not maintain hand-counted migration backlogs in prose. The generated
`design-system/census.json` and `design-system/migrations.json` files own the
complete core-plus-official-Bits fleet and its exact legacy ceilings. Every
completed migration lowers those ceilings; no new legacy use is allowed.

`design-system/exceptions.json` contains only explicitly approved, temporary,
path-scoped deviations from the current public Storybook contract. It is not a
second migration ledger and cannot be used to preserve known legacy debt.

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
