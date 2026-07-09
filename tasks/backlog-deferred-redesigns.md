# Backlog — deferred behavior-touching redesigns

Distilled from the completed core-splits initiative log (formerly `tasks/plan.md`; full detail in git
history of that file). Everything here was deliberately NOT taken during the pure-relocation splits
because it changes behavior. Each item is independent; pick up as focused PRs.

## Core / server
- `server.ts` request handler: convert the ordered if/else dispatch into a declarative route table.
- `upgrade.ts` hasher consolidation: `computeSourceTreeSha` vs whiskit `hashSourceTree` have different
  skip-sets/formulas — consolidating changes stored `sourceTreeSha` values; needs a canonical pick +
  one-time reset, best with the remaining upgrade.ts split.
- Search modules: `transform()` `$inc`/`$push` narrowing, `pendingReconciles` swap idiom,
  `crossTableSearch` recursion, `getSearchAdapter` export hygiene.
- Shared dir-walker for the scripts (last WS7 item).
- docs-generate: escaper consolidation, plugin-list derivation, CLI-metadata redesign (output-risk).
- tests/** god-file splits.

## adapter-openclaw
- `deepMerge` dedup with `core/settings.ts` (cross-package).
- Settings/binary resolver extraction (relocates the class-central `OpenClawSettings` type).
- Tier-3 capability-subclass refactor of the runtime facade.
  (Note: check overlap with prelaunch-hardening PR 1a/1b before starting — streamChat and
  session-activity change there.)

## Plugins
- **workflows:** `decideGate` 6-block collapse; `stdJsonResponses` const; typed-route casts;
  `submit_step` error-message classification; gate-settings dual-source-of-truth; atomic
  `withInstance` writes; `contentDir`-param drop; `require`→`import`; discriminated
  `getCurrentStep` union.
- **schedule:** pause-`pauseUntil` behavioral drift fix (route vs exec copies); dead update-handler
  code; dead settings keys (`maxConcurrentJobs`, `failureCooldownMs`); ctx-threading; zod for
  `ensureBakinJob`.
- **tasks:** REST/MCP guard inconsistency; identifier-fallback dedup; dead `.catch` noise; `postJson`.
- **assets:** `mutateManifest` combinator; `iterateStoreManifests` walker; images-plugin sharp dedup.
- **health:** section-component split + per-section-fetch redesign; `SearchHealthData` promotion.
- **models:** 3-way sentinel cleanup; `postJson`; batch `saveAll`; `formatAge`/`RuntimeRestartBanner`/
  `TableSkeleton` SDK extractions.
- **workflow canvas editor:** `use-workflow-copy-form` cross-file dedup + slugify consolidation;
  `setIsDirty`-in-updater fix; `WorkflowStepPatch` typing; `postOrPut` helper; key-remount reset.

(SDK primitive adoption — useJsonFetch/ConfirmDialog/format utils/useAvailableModels relocation — is
NOT here: it's Task 34 of `.claude/specs/prelaunch-hardening/PLAN.md`.)
