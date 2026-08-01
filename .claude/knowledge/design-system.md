# Design System

## Approved visual direction (2026-07-18)

**Product Character** is the approved default for Bakin product UI and plugin
chrome. It uses bundled Space Grotesk for interface copy and bundled JetBrains
Mono for identifiers, code, numerals, and technical data. Its expressive
hierarchy, warm surfaces, selective brand signal, and restrained elevation are
the foundation for all Phase 3 component contracts and later migrations.

Operational Neutral was rejected as the global default because it felt more
generic and produced a weaker hierarchy. Its tighter row rhythm remains useful
evidence for tables, repeated rows, and operational data. That exception is a
contextual part of the one **compact-professional** density; it is not a
user-selectable density mode, alternate theme, or permission to switch fonts.

The approved source of truth is:

- `packages/ui/tokens/*.tokens.json` for DTCG reference, semantic, and
  component layers;
- generated `packages/ui/src/styles/tokens.generated.css`, typed metadata,
  public Storybook token specimens, and token documentation;
- `design-system/specimens/*-candidates.json` for the review decision and
  retained comparison evidence;
- `.claude/knowledge/style-guide.md` for composition and interaction rules.

The public semantic contract uses namespaced `--bakin-*` properties. Generic
aliases such as `--background`, `--accent`, or `--radius`, raw palette values,
and arbitrary Tailwind utilities are migration evidence rather than new author
contracts.

## Legacy color inventory (superseded authoring API)

Bakin retains the recognizable warm dark foundation, green primary action,
pink signal/accent, and yellow highlight. The tables below describe legacy
aliases still present during migration. Do not use their names as the future
SDK contract; use the generated semantic `--bakin-*` properties and supported
components instead.

### Surface Hierarchy (darkest → lightest)

These form the layering system. Use surface shifts instead of hard borders to separate regions.

| Token              | Hex       | Use                              |
|--------------------|-----------|----------------------------------|
| `background`       | `#0f0e0e` | Page background, sidebar         |
| `surface-low`      | `#151313` | Cards, recessed panels           |
| `surface-container`| `#1b1919` | Containers, muted fills          |
| `surface-high`     | `#211f1f` | Elevated cards, popovers         |
| `surface-highest`  | `#272525` | Tooltips, top-layer overlays     |
| `surface-bright`   | `#2e2b2b` | Hover states, bright accents     |

### Primary — Green (default CTA)

| Token                  | Hex       |
|------------------------|-----------|
| `primary`              | `#22c55e` |
| `primary-foreground`   | `#052e16` |

### Accent — Neon Pink (branding, links, highlights)

| Token                  | Hex       |
|------------------------|-----------|
| `accent`               | `#ff007f` |
| `accent-dim`           | `#e30071` |
| `accent-container`     | `#ff709e` |

### Secondary — Subtle surface action

| Token                | Hex       |
|----------------------|-----------|
| `secondary`          | `#272525` |
| `secondary-foreground` | `#ffffff` |

### Selection — Electric Yellow

| Token                | Hex       |
|----------------------|-----------|
| `selection`          | `#eaea00` |
| `selection-foreground` | `#555500` |

### Text

| Token               | Hex       |
|----------------------|-----------|
| `foreground`         | `#ffffff` |
| `muted-foreground`   | `#aeaaaa` |

### Outline

| Token             | Hex       |
|-------------------|-----------|
| `outline`         | `#787574` |
| `outline-variant` | `#4a4747` |

### Design Rules

1. Build hierarchy with typography, spacing, surface shifts, and subtle semantic dividers; do not wrap every region in a card.
2. Use restrained elevation only where spatial hierarchy requires it, primarily overlays.
3. Green is primary action, pink is selective product signal, and yellow is high-attention highlight; none is generic hover chrome.
4. The canvas remains warm near-black rather than pure black.
5. Active and hover states use neutral surface changes; focus uses the semantic focus token and remains visibly distinct.
6. Product Character spacing is canonical for pages and sections. Only explicit dense data contexts use the reviewed tighter row gap and height.

### Legacy Tailwind examples

These aliases remain during migration and are not the focused SDK contract:

```
bg-surface-low        → var(--surface-low)
bg-surface-container  → var(--surface-container)
bg-surface-high       → var(--surface-high)
text-primary          → var(--primary) — neon pink
text-secondary        → var(--secondary) — electric yellow
border-outline-variant → var(--outline-variant)
```

## Storybook taxonomy (refit P2, 2026-07-30)

Public entries are one-component-per-entry under intent sections; every entry
leads with a `CanonicalUsage` story (minimal, SDK-imports-only). The tree:

`Foundations/` tokens · `Primitives/` button, input, badge, avatar, card, … ·
`Overlays/` dialog, sheet, drawer, popover, tooltip, dropdown-menu ·
`Feedback/` system-state, alert, toast, banner, progress, skeleton,
status-badge/marker, confirm-dialog, danger-zone, search-trust ·
`Forms/` field composition, settings renderer, save-bar, unsaved-changes,
asset/model/color pickers · `Navigation/` command, tabs, facet-filter,
search-input, segmented-control, pagination, sortable-head ·
`Layout/` page-shell, stack/inline, grid, section, bounded-overflow ·
`Pages/` archetypes (WorkspacePage now; Page lands in refit P5) ·
`Lists/` list-rows, kanban (+ P5: data-table, timeline, calendar-grid, …) ·
`Charts/` line, area, bar, stacked-column, ranked-bar, pie, composition-bar,
sparkline, data-table, explainer, stat-tile, stat-group ·
`Conversation/` (sanctioned domain, unchanged) · `Agents/` avatar, select,
status (sanctioned domain) · `Content/` markdown content/editor ·
`Recipes/` assembly proofs (CanonicalUsage-exempt) · `Testing/` plugin UI
fixture host · `Internal/` direction studies + containment (maintainer only).

Shared scaffolding: `storybook/support/` (StoryStage/StorySection/StoryCluster/
OverlayBackdrop + icons). Visual baselines are named `<section>-<entry>.png`.

## Storybook refit gates (2026-07-29)

The storybook-refit effort (spec/audit/plan in `.claude/specs/storybook-refit*.md`)
added two monotonic ratchets that run inside `ui:conformance --quick`:

- **Story compliance** (`scripts/ui/story-compliance.ts`, baseline
  `design-system/story-compliance.json`): every public entry needs a
  `CanonicalUsage` first story (minimal, `@makinbakin/sdk/*`-imports-only JSX;
  `Recipes/` exempt), ≥1 play assertion, `parameters.bakinCoverage`,
  `parameters.docs.description.component`, and a `tests/ui/visual` reference.
  The baseline was deleted 2026-07-30 (refit P3) — the gate runs in ABSOLUTE mode; every gap fails immediately.
- **Kit growth** (`scripts/ui/kit-growth.ts`, baseline
  `design-system/kit-coverage.json`): every PascalCase value export of the
  supported SDK UI entrypoints must be imported by the public catalog —
  new kit components cannot land without a story (D9).

Shared story scaffolding lives in `storybook/support/` (`StoryStage`,
`StoryIntro`, `OverlayBackdrop`, inline icons). It is an allowed import root
for public stories (walked by the same boundary checks), banned inside
`CanonicalUsage` stories, and banned from app code
(`tests/architecture/storybook-support-boundary.test.ts`).

Autodocs is on globally (`.storybook/preview.tsx` `tags: ['autodocs']`):
docs pages + source panels render for every entry; props tables come from
TS types via react-docgen.

## Logo

The Bakin logo (`public/bakin-logo.svg`) is `bakin-hop.svg` — a leaping bison rendered in `#ff4d94`. Product chrome pairs it with the approved Space Grotesk family; logo artwork itself remains brand content rather than a UI token.

## Agent Avatars

Avatars are **per-installation content** stored as `~/.bakin/agents/{id}/avatar.{webp,png,jpg}` (128px thumbnails). The shared resolver in `packages/core/src/agents/avatar.ts` is the single source of truth: it resolves the file by priority **webp → png → jpg**, sets the matching `Content-Type` (from `IMAGE_EXTENSION_TO_MIME`), and emits `ETag`/`Last-Modified` so re-uploads invalidate the cache. Served via `GET /api/agents/avatar?id={agentId}` and `GET /api/plugins/team/{agentId}/avatar`, NOT as static files. Uploads preserve the uploaded format (detected by magic bytes; non-images rejected) and drop any stale other-format sibling. **Prefer WebP** for new avatars — ~40–50% smaller than equivalent-quality JPEG. Full-res originals at `avatar-full.png` in the same directory.

## Version

`APP_VERSION` is exported from `packages/core/src/constants.ts` and served by the `/api/version` endpoint. The header displays it as `v{version}`. Bump this constant when cutting releases.

The shell may render a fixed Bakin update banner above the header when
`/api/update/status` reports a newer binary release. The banner sets
`--bakin-header-top` and `--bakin-shell-top` on `document.documentElement` so
the fixed header/sidebar/content move down together instead of overlapping.
Source/dev/Bun runtimes are unsupported for browser self-update and should not
show the banner.
