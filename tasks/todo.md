# TODO: Reindex Enrichment Observability (#74)

## Tasks

- [ ] **T1:** Add `getIndexHealth()` to `src/core/antfly.ts` + tests in `tests/core/antfly.test.ts`
  - AC: New function exported, wraps `indexes.list()`, returns `IndexHealth | null`
  - AC: 5 new test cases pass (export, disabled, healthy, errors, wal_backlog)
  - Verify: `npx vitest run tests/core/antfly.test.ts`
  - Commit: `feat(search): add getIndexHealth() for enrichment status (#74)`

- [ ] **T2:** Enrichment audit in `reindexContentTypes()` + tests
  - Depends: T1
  - AC: After each table reindex, `getIndexHealth()` called and anomalies logged
  - AC: Per-table result includes `enrichment` field with index health
  - AC: 4 new test cases pass (healthy, errors, null/unavailable, broadcast order)
  - Verify: `npx vitest run tests/core/search-registry.test.ts`
  - Commit: `feat(search): enrichment audit after reindex with enriched response (#74)`

- [ ] **T3:** Update `server.ts` reindex handler for enriched response
  - Depends: T2
  - AC: `/api/reindex` response includes `enrichmentErrors` count
  - AC: `ok` reflects both batch and enrichment errors
  - AC: `verify` query param parsed and passed through
  - Verify: Read diff, confirm passthrough logic
  - Commit: `feat(search): expose enrichment errors in reindex API response (#74)`

  **--- Checkpoint: Layers 1+2 complete. Reindex now surfaces enrichment failures in logs and API. ---**

- [ ] **T4:** Extend `getSearchHealth()` with per-index health + tests
  - Depends: T1
  - AC: Health response includes `indexHealth` array and `healthy` boolean per table
  - AC: 4 new test cases pass (with health, healthy true, healthy false, null handling)
  - Verify: `npx vitest run tests/core/search-registry.test.ts`
  - Commit: `feat(search): add enrichment status to health endpoint (#74)`

- [ ] **T5:** Health page UI enrichment indicators
  - Depends: T4
  - AC: Table cards show green/amber/red indicator based on enrichment health
  - AC: Error tooltip shows the actual error message
  - AC: Component compiles without TypeScript errors
  - Verify: `npx tsc --noEmit`, visual check in browser
  - Commit: `feat(health): enrichment status indicators on search table cards (#74)`

  **--- Checkpoint: Layer 4 complete. Health page shows enrichment status at a glance. ---**

- [ ] **T6:** Verify mode (`?verify=true`) in `reindexContentTypes()` + server.ts + tests
  - Depends: T1
  - AC: `reindexContentTypes({ verify: true })` re-queries table after reindex
  - AC: Result includes `verified` and `verifyDiscrepancy` when verify=true
  - AC: Default (no verify) does not add extra queries
  - AC: 4 new test cases pass
  - Verify: `npx vitest run tests/core/search-registry.test.ts`
  - Commit: `feat(search): add opt-in verify mode to reindex (#74)`

  **--- Checkpoint: Layer 3 complete. Full pipeline honest about what landed. ---**

- [ ] **T7:** Update `.claude/knowledge/search-system.md` with enrichment observability docs
  - Depends: T1-T6
  - AC: New "Enrichment Observability" section documents all four layers
  - AC: Response shapes documented with examples
  - AC: SDK types referenced for future maintainers
  - Verify: Read and confirm accuracy
  - Commit: `docs(search): document enrichment observability pipeline (#74)`

## Summary

| Task | Layer | Files | Test count |
|------|-------|-------|------------|
| T1 | Foundation | antfly.ts, antfly.test.ts | 5 |
| T2 | L1+L2 | search-registry.ts, search-registry.test.ts | 4 |
| T3 | L2 | server.ts | 0 (passthrough) |
| T4 | L4 | search-registry.ts, search-registry.test.ts | 4 |
| T5 | L4 | health-page.tsx | 0 (visual) |
| T6 | L3 | search-registry.ts, search-registry.test.ts | 4 |
| T7 | Docs | search-system.md | 0 |
| **Total** | | **7 files** | **17 tests** |
