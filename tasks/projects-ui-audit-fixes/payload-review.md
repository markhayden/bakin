# Projects audit payload review

Status: user approved the exact four ceilings on 2026-09-23. Applied only the four numeric fields below; all other limits and the review threshold are unchanged.

Measured from the production vendor build and current official Projects client.
The shared Markdown comparison adds **2,943 bytes**. Projects adds **32,924 bytes**
for protected staged drafts, conflict handling, reliable checklist operations,
history/error state, exit coordination, and the responsive detail composition.
The SDK entry and vendor figures below describe the same artifact, not separate downloads.

| Exact ceiling | Approved | Proposed | Delta |
| --- | ---: | ---: | ---: |
| `sdkUiBundles[name=sdk-content].bytes` | 347,526 | 350,469 | +2,943 |
| `sdkUiBundles[name=sdk-content].reachableBytes` | 842,950 | 845,893 | +2,943 |
| `vendorChunks[path=packages/host/public/vendor/sdk-content.js].bytes` | 347,526 | 350,469 | +2,943 |
| `pluginClients[repository=bakin-bits-official,pluginId=projects].bytes` | 106,454 | 139,378 | +32,924 |

All other ceilings stay unchanged. Canonical CSS measures 191,349 bytes, below its
191,737-byte ceiling. The existing **2,048-byte review threshold** stays unchanged.
No new bundle, duplicate stylesheet, or public entrypoint is introduced.

## Attribution and alternatives

- The comparison uses the existing full-document remark pipeline; its directly
  imported parser dependencies are declared. Projects' old block splitter is deleted.
- Client validation uses narrow runtime guards. An earlier Zod import was removed
  from the browser boundary; server-only schemas stay server-only.
- Draft/checklist helpers remain Projects-owned. Canonical Form, SaveBar, dialogs,
  navigation, AgentSelect and Markdown renderers remain external SDK imports.
- Removing the extra code would remove approved conflict protection, retry safety,
  truthful error states or coordinated exits. No dependency or threshold inflation
  is proposed to hide those changes.

## Reproduction and application

`bun run build:css`, `bun run build:vendors`, then
`collectUiPerformanceSnapshot()` from `scripts/ui/performance.ts`.
The collected snapshot is `payload-candidate.json` beside this review. The gate
reports exactly the four entries above. On approval, change only those four
numeric fields in `design-system/performance.json`; do not regenerate the rest.

Baseline SHA-256: `1150ea5af517c09d3c6499eb0a83fd56567108227bec194c7aca7a07585d4a5e`.
Candidate SHA-256: `6df4e2b492d844ca0a33d66d673a64107d46021d19efd67b0701dbb65532a242`.
