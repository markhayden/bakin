# Design System

## Color Theme

Bakin uses a warm dark theme with neon pink as the primary accent and electric yellow as the secondary/selection color. All colors are defined as CSS custom properties in `packages/host/src/globals.css` (compiled to `packages/host/public/globals.css` by `bun run build:css`) and mapped to Tailwind via the `@theme inline` block.

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

1. **No hard borders** — use surface hierarchy shifts and `outline-variant` at low opacity (10–30%) for ghost borders.
2. **Shadows are color-tinted** — pink or yellow glow, never gray/black.
3. **Selection color** is electric yellow (`#eaea00`).
4. **Background is warm near-black** (`#0f0e0e`), never pure `#000`.
5. **Active/hover states** use subtle alpha overlays or surface step-ups, not color changes.

### Tailwind Usage

All tokens are available as Tailwind utilities via the `@theme inline` mapping:

```
bg-surface-low        → var(--surface-low)
bg-surface-container  → var(--surface-container)
bg-surface-high       → var(--surface-high)
text-primary          → var(--primary) — neon pink
text-secondary        → var(--secondary) — electric yellow
border-outline-variant → var(--outline-variant)
```

## Logo

The Bakin logo (`public/bakin-logo.svg`) is `bakin-hop.svg` — a leaping bison rendered in `#ff4d94`. Source variants live on the Desktop (`bakin-1.svg`, `bakin.svg`, `bakin-traditional.svg`, `bakin-basic.svg`, `bakin-basic-nose.svg`, `bakin-primary.svg`, `bakin-full.svg`, `bakin-hat.svg`, `bakin-hop.svg`). Header text is Inter bold italic, white, `text-base`.

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
