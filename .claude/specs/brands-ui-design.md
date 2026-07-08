# Brands UI — Design language (premium showcase)

North star for the brands surface (#419 UI). Target: modern, decisive, uncrammed —
a flagship the rest of Bakin can later adopt. Built ON Bakin's real tokens, not
invented ones.

## The signature: the brand paints its own page

Each brand's page is quietly tinted and accented by its OWN palette. The chrome
is calm and near-monochrome; the brand's colors are the only strong color on the
page. Distinctive by construction — the accent is the *data*, different per
brand — so it never reads as the AI-default single-acid-accent look, and it
doubles down on the palette-band hero the operator already responded to.

- Hero: full-width proportioned palette band + name + status; the panel below is
  ambient-tinted from the brand's PRIMARY palette color (`color-mix` ~6-10%).
- Active tab underline, stat accents, focus rings, and small "brand chrome"
  moments pull the brand's primary color where it reinforces identity. The app's
  own accent (fuchsia) stays reserved for the ONE primary action per context.
- Unbranded/no-palette state degrades to neutral surfaces + a gentle prompt.

## Principles (what changes vs. the current dump)

1. **Type hierarchy, not uniform 11px.** A real scale (below). Headings breathe;
   only truly incidental text is micro.
2. **Elevation, not boxes.** Group with a subtle surface lift + whitespace, NOT a
   border around everything. Borders are hairline and rare (dividers, inputs).
3. **Whitespace is structure.** Generous section rhythm; comfortable card padding.
4. **Decisive actions.** Exactly one filled/primary action per context; everything
   else is secondary (subtle) or ghost (text). Destructive is red and isolated.
5. **Color does work.** Neutral chrome + the brand's palette as the accent system.
   Status/semantic color (emerald=healthy, amber=attention, red=destructive) used
   sparingly and consistently.
6. **Motion is restrained.** `transition-colors`/hover lifts, tab crossfade; honor
   reduced-motion. No decorative animation.

## Tokens (use Bakin's REAL tokens; verified against globals.css)

Bakin's #1 design rule: **NO hard borders** — separate regions with the surface
elevation ladder, not outlines. This IS the fix for "boxes everywhere."

Surface elevation ladder (darkest→lightest):
- Page `bg-surface`/`bg-background` (#0f0e0e warm near-black, never #000).
- Card/panel `bg-card` (#151313) — pair with `ring-1 ring-foreground/10` (soft
  hairline ring, NOT border). Or the SDK `Card` component (already does this).
- Recessed/inset `bg-surface`/`bg-muted/40`; containers `bg-surface-container`.
- Elevated `bg-surface-high`; hover `bg-surface-bright` or `/80`-`/90` alpha
  shifts (hover = surface step-up or alpha, NEVER hue change).
- Ghost borders only where truly needed: `border-outline-variant` at 10-30% α.
- Radius: `rounded-xl` cards/hero, `rounded-lg` controls, `rounded-md` inputs.
- Shadows are COLOR-TINTED (pink/yellow glow), never gray/black — reserve for
  the one hero/elevated moment: `shadow-[0_0_24px_rgba(255,0,127,0.10)]`.

Color reality (correction): **primary CTA = GREEN** (`Button variant="default"`,
#22c55e). **Accent = PINK** (#ff007f, `variant="accent"`, `bg-accent`,
`text-accent`). Semantic: `text-success`/`text-warning`/`text-destructive`/
`text-info`. The brand's OWN palette (hex from its manifest) is applied inline
only for the band / ambient tint / swatches — the identity accent system.
Actions: filled `default`(green) for the one primary; `outline`/`secondary`/
`ghost` otherwise; delete uses `text-red-400` (not `variant="destructive"` per
the overflow-menu convention). Section labels:
`text-[11px] font-medium uppercase tracking-wider text-muted-foreground`.

Icons: `lucide-react` (direct import), `size-4`/`size-3.5`.
Motion: `transition-colors`/`transition-all`, `tw-animate-css` (`animate-in
fade-in`); add `motion-reduce:transition-none` (net-new premium touch).

Text scale (foreground opacity ladder — stop muting everything):
- Page title (hero name): `text-2xl font-semibold` (~24px), `text-foreground`.
- Section heading: `text-base font-medium` (~16px), `text-foreground`.
- Body: `text-sm` (~14px), `text-foreground/90`.
- Label / secondary: `text-xs`, `text-muted-foreground`.
- Micro (incidental only): `text-[11px] text-muted-foreground`.
- Numbers/data: `tabular-nums`.

Actions (SDK `Button` from `@makinbakin/sdk/ui`):
- Primary (one per context): filled — the SDK's default/solid variant.
- Secondary: `secondary`/`outline`. Tertiary: `ghost`. Destructive: `destructive`.
- Icon + label for primary actions where an icon clarifies (lucide-react).

Icons: `lucide-react` (available to plugins). Palette, Image, FileText, Sparkles,
Upload, Plus, Check, AlertTriangle, ExternalLink, Pencil, etc. Keep to ~16px,
`text-muted-foreground` unless semantic.

## Layout system for a brand page

```
┌ HERO ─────────────────────────────────────────────────┐
│ ███████████▓▓▓▓▒▒▒   ← palette band, full width        │
│ [logo] Acme  ·acme·  ● Published        [ Primary CTA ]│
│        Warm bakery software…                           │
└────────────────────────────────────────────────────────┘  (ambient tint)

 Overview   Identity   Docs   Lessons   Assets   Settings   ← quiet tabs,
 ──────────                                                    brand-tinted underline

 ── content: whitespace-separated groups, few borders ──
```

- Max content width ~`max-w-6xl`? No — full-width with padding (app convention),
  BUT constrain long single-column reading blocks (voice snapshot, docs) so lines
  don't stretch; multi-col dashboards use the width.
- Stat tiles: `bg-card` cards, big `tabular-nums` value, small label, an accent
  meter where relevant. Hover-liftable when they navigate.

## Per-screen application (order)

1. **Brand detail** — reference implementation. Lock the look here first.
2. **Brand list** — palette-band cards, same language.
3. **Build-my-brand wizard** — drawer already; align type/spacing/actions + a
   cleaner logo step.
4. **Task brand panel** (in tasks) — compact version of the same tokens.

## Guardrails

- No new color hexes — use tokens + the brand's own palette values (already hex
  from the manifest, applied inline only for the band/tint/swatches).
- Keep all existing behavior/endpoints; this is a visual + interaction-polish
  pass, not a data change.
- Accessibility floor: visible focus, keyboard paths, reduced-motion, contrast.
