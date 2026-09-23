# Full-divider highlight correction

Status: user approved and applied both exact corrected snapshots on 2026-09-23. Candidate and prior-destination hashes were verified before replacement. The previously approved payload update remains applied; no additional payload adjustment was needed.

The user's follow-up clarified that both complete divider lines should highlight, with a short centered grip on each. The side line in the screenshot is Projects' own progress/sidebar resizer, not the overlay Drawer. The correction updates that exact Projects control and the shared conversation/drawer treatment: faint centered grip at rest, full-length 50% pink on hover or keyboard focus, solid pink during dragging. Existing resize values, storage keys, keyboard behavior, and mobile layout remain intact.

## Actual Projects preview

[Bottom divider highlighted](projects-bottom.png) · [Side divider highlighted](projects-side.png)

Both controls were inspected in the running Crab preview. Their settled hover colors match exactly. The side grip is centered vertically; the bottom grip is centered horizontally.

## Two refreshed canonical snapshots

These candidates were rendered with the canonical Playwright 1.60.0 Noble Linux/x64 image. They update only the full-length highlight in the focused desktop drawer handles. Mobile snapshots and the other affected visuals pass unchanged.

| Pattern | Currently approved | Corrected candidate | Difference |
| --- | --- | --- | --- |
| Drawer / Default | [Before](drawer-expected.png) | [After](drawer-actual.png) | [Diff](drawer-diff.png) |
| Panel and tool detail / ExactToolDetail | [Before](tool-detail-expected.png) | [After](tool-detail-actual.png) | [Diff](tool-detail-diff.png) |

[Manifest](manifest.json) pins both destination paths, current baseline hashes, and exact candidate hashes. Both exact candidates have been applied to their pinned destinations.

## Verification

- Quick conformance passes (228 architecture tests and TypeScript); official Bits typecheck and build pass.
- Nine affected Storybook tests pass.
- Six resize browser checks pass across Chromium, Firefox, and WebKit, including full-length hover/focus/drag color.
- Official installed-package fixtures pass, including all eight Projects detail scenarios and both real Projects divider hover/grip/keyboard checks.
- Canonical visuals after approval: all 26 affected desktop/mobile checks pass against the exact approved baselines.
- Payload ratchet passes without changing another ceiling.
- The Projects handle now uses semantic spacing instead of one raw width utility; the matching migration allowance and summary each decrease by one.

Patterns remain `storybook/public/overlays/drawer.stories.tsx` (`CanonicalUsage`, `Default`) and `storybook/public/conversation/panel-and-drawer.stories.tsx` (`DocumentDividerPanel`, `ExactToolDetail`), composed through the existing SDK `/ui`, `/conversation`, and `/hooks` contracts. No public API addition.
