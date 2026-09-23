# Shared resize grip review

Status: user approved and applied on 2026-09-23. Verified all candidate and prior-destination SHA-256 hashes before applying exactly the two PNGs and shared-payload proposal. All other ceilings and the review threshold remain unchanged.

The subsequent [full-divider correction](full-divider/README.md) supersedes these two visual candidates with separately approved images. This review's payload approval remains current.

The drawer and embedded conversation now share the resize grip and pointer/keyboard implementation. Both boundary grips stay faintly visible at rest, turn pink on hover and keyboard focus, and hold the highlight during pointer capture. Existing size limits, mobile drawer behavior, and storage keys remain unchanged. Composer and tool-detail handles also inherit the pink interaction feedback; their idle visibility is unchanged.

## Two exact desktop visual replacements

Canonical Chromium in `mcr.microsoft.com/playwright:v1.60.0-noble`, Linux x64. Changes are confined to resize feedback; 24 other affected desktop/mobile checks pass. The drawer now uses the same visible keyboard-focus outline as the conversation handle.

| Pattern | Before | Candidate | Difference |
| --- | --- | --- | --- |
| Drawer / Default | [Before](drawer-expected.png) | [After](drawer-actual.png) | [Diff](drawer-diff.png) |
| Panel and tool detail / ExactToolDetail | [Before](tool-detail-expected.png) | [After](tool-detail-actual.png) | [Diff](tool-detail-diff.png) |

[Manifest](manifest.json) pins each destination, current baseline hash, and candidate SHA-256. Approval applies only to these two PNGs.

## One shared-payload ceiling adjustment

The consolidation moves the shared resize helper out of entry-specific code into a common chunk. It adds no dependency or public API. Total vendor JavaScript measured against the checked-in baseline decreases by **326 bytes**.

| Metric | Reviewed | Measured | Delta |
| --- | ---: | ---: | ---: |
| Aggregate SDK shared chunks | 938,540 | 941,729 | +3,189 |
| All vendor JavaScript | 1,730,558 | 1,730,232 | −326 |
| SDK UI entry | 8,728 | 7,395 | −1,333 |
| SDK conversation entry | 55,829 | 53,647 | −2,182 |
| SDK UI reachable bytes | 501,809 | 503,592 | +1,783 |
| SDK conversation reachable bytes | 711,630 | 712,637 | +1,007 |

The [exact proposal](performance-proposal.json) replaces only the shared chunk records in `design-system/performance.json`, which define the aggregate ceiling. All other ceilings and the **2,048-byte** review threshold remain unchanged. [Measurements](measurements.json) contain the full current snapshot. The proposal passes `diffUiPerformance` against those measurements.

Keeping separate resize implementations would avoid moving their code into shared chunks but retain duplicated behavior. Raising the review threshold or unrelated ceilings is unnecessary.

## Verification

- Quick conformance: 228 architecture tests and TypeScript pass.
- Full conformance: lint and all 10,010 repository tests pass; the initial run stopped at the shared-payload review gate above. After approval, the payload ratchet passes with all unrelated ceilings unchanged.
- Affected Storybook stories: 9 pass.
- Canonical resize browser coverage: 6 pass across Chromium, Firefox, and WebKit; checks idle/hover/focus/drag color, pointer capture, keyboard resizing, persistence, and mobile visibility.
- Affected canonical visuals after approval: all 26 desktop/mobile checks pass against the exact approved images.
- SDK package dry run passes; no package was published. The restarted Crab preview confirms idle opacity `0.6` and hover opacity `1` with the canonical pink (`rgb(255, 0, 127)`).

Public patterns: `storybook/public/overlays/drawer.stories.tsx` (`CanonicalUsage`, `Default`) and `storybook/public/conversation/panel-and-drawer.stories.tsx` (`DocumentDividerPanel`, `ExactToolDetail`). Focused contracts remain `@makinbakin/sdk/ui` and `/conversation`; no deviation or public API addition.
