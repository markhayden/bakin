---
title: Semantic UI Tokens
description: Generated public semantic token contract for Bakin product and plugin interfaces.
---

This reference is generated from the DTCG token source. Use the namespaced CSS properties through [`@makinbakin/sdk/styles.css`](/docs/extending/ui/overview/); internal reference values, component aliases, and Tailwind mappings are not plugin-author contracts.

The current candidate contains **27 public tokens** across **5 semantic families**. Contrast ratios are calculated during generation. A declared WCAG role below its threshold fails generation and CI.

## Color

| Token | Intent | Value | CSS property | Status | Contrast | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic.color.action.primary.background` | Fill for the primary action on a surface. | `#22c55e` | `--bakin-color-action-primary-background` | Public semantic | 6.54:1 vs `--bakin-color-action-primary-foreground`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/action/primary/background` |
| `semantic.color.action.primary.foreground` | Text and icon color placed on the primary action fill. | `#052e16` | `--bakin-color-action-primary-foreground` | Public semantic | 6.54:1 vs `--bakin-color-action-primary-background`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/action/primary/foreground` |
| `semantic.color.border.subtle` | Low-emphasis separators and nonessential boundaries; never the only state indicator. | `#4a4747` | `--bakin-color-border-subtle` | Public semantic | 2.01:1 vs `--bakin-color-surface-default`; reference comparison | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/border/subtle` |
| `semantic.color.canvas.default` | The application background behind default surfaces and page content. | `#0f0e0e` | `--bakin-color-canvas-default` | Public semantic | 19.28:1 vs `--bakin-color-text-primary`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/canvas/default` |
| `semantic.color.focus.ring` | Keyboard focus indicator on the application canvas. | `#22c55e` | `--bakin-color-focus-ring` | Public semantic | 8.46:1 vs `--bakin-color-canvas-default`; WCAG AA non-text UI ≥ 3:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/focus/ring` |
| `semantic.color.signal.accent` | Brand accent for selected or emphasized non-text signal marks on the canvas. | `#ff007f` | `--bakin-color-signal-accent` | Public semantic | 5.1:1 vs `--bakin-color-canvas-default`; WCAG AA non-text UI ≥ 3:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/signal/accent` |
| `semantic.color.signal.danger` | Destructive and error signal marks on the canvas. | `#ef4444` | `--bakin-color-signal-danger` | Public semantic | 5.12:1 vs `--bakin-color-canvas-default`; WCAG AA non-text UI ≥ 3:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/signal/danger` |
| `semantic.color.signal.highlight` | High-attention non-text highlight on the canvas. | `#eaea00` | `--bakin-color-signal-highlight` | Public semantic | 14.93:1 vs `--bakin-color-canvas-default`; WCAG AA non-text UI ≥ 3:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/signal/highlight` |
| `semantic.color.surface.default` | The default bounded surface placed above the application canvas. | `#151313` | `--bakin-color-surface-default` | Public semantic | 18.51:1 vs `--bakin-color-text-primary`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/surface/default` |
| `semantic.color.text.muted` | Secondary copy, metadata, and helper text on the application canvas. | `#aeaaaa` | `--bakin-color-text-muted` | Public semantic | 8.38:1 vs `--bakin-color-canvas-default`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/text/muted` |
| `semantic.color.text.primary` | Primary copy, labels, and high-emphasis interface text on the application canvas. | `#ffffff` | `--bakin-color-text-primary` | Public semantic | 19.28:1 vs `--bakin-color-canvas-default`; WCAG AA normal text ≥ 4.5:1; pass | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/color/text/primary` |

## Layout space

| Token | Intent | Value | CSS property | Status | Contrast | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic.layout.space.0` | Removes structural separation without introducing a magic value. | `0px` | `--bakin-layout-space-0` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/0` |
| `semantic.layout.space.1` | Tight internal separation for compact details. | `0.25rem` | `--bakin-layout-space-1` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/1` |
| `semantic.layout.space.2` | Compact separation between closely related controls or content. | `0.5rem` | `--bakin-layout-space-2` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/2` |
| `semantic.layout.space.3` | Comfortable separation within a control group or content cluster. | `0.75rem` | `--bakin-layout-space-3` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/3` |
| `semantic.layout.space.4` | Default separation between sibling interface regions. | `1rem` | `--bakin-layout-space-4` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/4` |
| `semantic.layout.space.6` | Section-level separation between distinct content groups. | `1.5rem` | `--bakin-layout-space-6` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/6` |
| `semantic.layout.space.8` | Strong page-level separation between major regions. | `2rem` | `--bakin-layout-space-8` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/layout/space/8` |

## Motion

| Token | Intent | Value | CSS property | Status | Contrast | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic.motion.duration.feedback` | Short response for direct control feedback and micro-state changes. | `120ms` | `--bakin-motion-duration-feedback` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/motion/duration/feedback` |
| `semantic.motion.duration.instant` | No-transition response for reduced motion and immediate state changes. | `0ms` | `--bakin-motion-duration-instant` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/motion/duration/instant` |
| `semantic.motion.duration.transition` | Standard duration for functional spatial and hierarchy transitions. | `180ms` | `--bakin-motion-duration-transition` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/motion/duration/transition` |
| `semantic.motion.easing.standard` | Default restrained easing for functional interface transitions. | `cubic-bezier(0.2, 0, 0, 1)` | `--bakin-motion-easing-standard` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/motion/easing/standard` |

## Radius

| Token | Intent | Value | CSS property | Status | Contrast | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic.radius.control` | Corner radius for compact controls and small interactive elements. | `0.25rem` | `--bakin-radius-control` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/radius/control` |
| `semantic.radius.overlay` | Corner radius for dialogs, popovers, and other elevated overlays. | `0.75rem` | `--bakin-radius-overlay` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/radius/overlay` |
| `semantic.radius.pill` | Fully rounded shape for badges, chips, and pill controls. | `999px` | `--bakin-radius-pill` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/radius/pill` |
| `semantic.radius.surface` | Corner radius for bounded content surfaces. | `0.5rem` | `--bakin-radius-surface` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/radius/surface` |

## State

| Token | Intent | Value | CSS property | Status | Contrast | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic.state.opacity.disabled` | Opacity applied to a disabled control while preserving its semantic state. | `0.48` | `--bakin-state-opacity-disabled` | Public semantic | Not applicable | [semantic.tokens.json](https://github.com/markhayden/bakin/blob/main/packages/ui/tokens/semantic.tokens.json) `#/semantic/state/opacity/disabled` |
