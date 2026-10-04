# Spec: Search migration recovery

Status: implementation authorized by “do the follow up”; based on merged
ownership fix #950 at `3abef4e8c`. Plan: [search-migration-recovery-plan.md](search-migration-recovery-plan.md).

## Objective and scope

Recover interrupted blue/green backfills without losing documents, abandoning
the recorded target, or rebuilding healthy indexes on unavailable evidence.
This implements the migration follow-up recorded in #826's ownership spec.
Keep the current schema, adapter contract, retry limits, and process model.
No browser UI, dependency, service ownership, or deployment changes.

## Required behavior

- A create/backfill/enumerator failure after migration intent is persisted
  parks that same target while retaining the active query target and dual
  writes. Explicit callers still receive the original failure. The update
  must not affect a removed or superseded target.
- Returned per-item batch failures are failures too; never count a rejected
  document as backfilled. Do not infer failure from the indexed count alone,
  since replay/upsert accounting may differ between adapters.
- Failed or crash-interrupted partial backfills replay the restartable source
  into the recorded target. A partial `backfill_done` count is not completion
  evidence. Completed backfills retain the existing convergence-only fast path.
  Use existing phase/count fields; no completion schema or compatibility shim.
- A resume failure for one parked table does not block other tables. The pump
  counts failed attempts even if its later engine listing fails and retains
  its five-attempt limit. Explicit resumed-but-parked repairs report parked,
  so the reindex job cannot incorrectly report success.
- Default repair propagates failed statistics/list reads without changing the
  registry or enumerating content. Null table status is only absence evidence
  when a successful table listing confirms the physical is missing. A listed
  but unreadable table fails honestly; it is not rebuilt. Forced rebuilds
  remain an explicit operator choice.
- Apply the same evidence rule where recovery could create an already-listed
  target or promote an unconverged target over an unreadable active index.
  Known-empty or authoritatively missing active tables retain the existing
  dominance recovery behavior.
- Matching startup remains zero engine calls. The active pointer flips only
  after a complete backfill and valid convergence/dominance evidence. Cold
  tombstone retirement remains unchanged.

## Implementation and testing

Use Bun 1.3.13, TypeScript strict, existing SQLite registry transactions and
typed adapter errors. Follow existing functions and error boundaries; prefer
small conditional changes over a new recovery abstraction. For example,
`if (listed.some(table => table.name === physical)) throw new Error(...)`
expresses indeterminate status before any destructive action.

Production files: `packages/core/src/search/tables.ts` (state and continuation)
and `src/core/search-registry-core.ts` (repair and pump). Tests live beside the
existing registry/table coverage under `tests/core/`. Knowledge documentation:
`.claude/knowledge/search-system.md`; user operations docs only if their stated
behavior needs correction. README/onboarding behavior is unaffected.

Tests must use temporary Bakin/OpenClaw homes, both content-dir mocks, fake
engine adapters, and closed SQLite handles before cleanup. Inject failures
after at least one successful 50-document chunk and confirm every source key
lands after recovery. Cover create failure, enumerator failure, preserved
nonce/dual writes, repeated failure, unrelated-table progress, retry cap,
unknown/listed/missing evidence, and honest reindex job results.

Commands:

```sh
bun test --isolate tests/core/search-tables.test.ts tests/core/search-registry.test.ts
bun run typecheck
bunx --no-install eslint packages/core/src/search/tables.ts src/core/search-registry-core.ts tests/core/search-tables.test.ts tests/core/search-registry.test.ts
bun run test
bun run build
git diff --check
```

Always reproduce failures before fixes, preserve the old query target, and
review/test each slice. Never access production homes or the running engine.
Schema, adapter-interface, and unrelated migration redesigns are outside scope.
No unresolved product decisions require further user input.
