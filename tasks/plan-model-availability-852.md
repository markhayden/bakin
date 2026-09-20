# Implementation Plan: Model Availability Reflects Account-Callable Reality (#852)

**Spec:** `.claude/specs/model-availability-852.md` (approved 2026-09-19)
**Branch:** `feat/852-model-availability`, cut from `main` in the MAIN checkout (test-live-before-merge:
3737 serves this tree; Mark live-tests before merge; server-side changes need a manual restart that
only Mark triggers — never kill the live dev server).

## Overview

Three layers, built bottom-up along the dependency graph: (1) the typed rejection signal
(`model_not_supported`), (2) durable evidence (`model_rejections` ledger table + the single
facade recording chokepoint), (3) consumers (availability overlay → health/recommender/UI,
opt-in probe, codex carrier ladder). Each task is a green, revertible commit; checkpoints run
the full gate.

## Dependency Graph

```
T1 kind (contract + core switches)
 ├── T2 Pi classification + attribution fixes
 │     └── T10 carrier ladder (needs typed rejection to ladder on)
 ├── T3 ledger table + verbs
 │     └── T4 facade recording wrapper        (needs T1 kind + T3 verbs; observes T2 output)
 │           ├── T5 availability overlay      (reads ledger)
 │           │     ├── T6 health evidence sharpening
 │           │     └── T7 UI rejected badge
 │           └── T9 probe-on-refresh          (outcomes ride T4)
 └── T8 optional models.probe contract + Pi impl   (independent after T1; T9 needs it)
T11 docs (last), T12 final gate + PR
```

Sequential spine: T1 → T2 → T3 → T4. After T4, {T5→T6→T7}, {T8→T9}, {T10} are independent
tracks; we run them in that order anyway (single session, priorities: passive layer first,
probe second, ladder third — matches the spec's value ordering).

## Commit Strategy

One conventional commit per task, in task order — each is a natural rollback checkpoint:

| # | Commit | Rollback note |
|---|--------|---------------|
| 1 | `feat(core): add model_not_supported runtime error kind` | Pure additive union + switch arms; revert = clean |
| 2 | `feat(adapter-pi): classify account model rejections; attribute stream + carrier errors` | Depends on 1 |
| 3 | `feat(core): model_rejections ledger table (migration v9)` | SQLite migrations are forward-only: reverting the commit leaves an unused table behind (harmless, single-user box; `DROP TABLE` manually if ever desired). Code revert is safe — nothing else references it |
| 4 | `feat(core): record model rejections at the runtime facade` | Revert restores pass-through adapter; table stops being written |
| 5 | `feat(models): account-rejection overlay flips model availability` | Revert restores catalog-only availability; ledger keeps accumulating silently |
| 6 | `feat(models): route-model-missing distinguishes account rejections` | Evidence-only change |
| 7 | `feat(models): rejected-model badge on Available Models` | UI-only |
| 8 | `feat(runtime): optional models.probe capability (pi)` | Additive optional contract member |
| 9 | `feat(models): opt-in probe-on-refresh with per-model verdicts` | Depends on 8; revert removes the param + UI action |
| 10 | `feat(adapter-pi): carrier fallback ladder for codex images` | Depends on 2; revert restores single-carrier hard-fail (typed + attributed via 2) |
| 11 | `docs(knowledge): model availability truth, rejection ledger, probe, carrier ladder` | Docs only |

Rules: every commit passes `bun run lint` + the tests it touches; checkpoints run the full
suite (`bun run test`). No commit references a later commit's code (revert-safety). Commits
end with the Claude attribution line. `packages/host/src/api/_embedded-assets-static.ts` is
currently dirty from a prior build — never staged into these commits. Never commit
`generated-version.ts` mutations after builds.

## Task List

### Phase 1 — Typed signal (foundation)

#### Task 1: `model_not_supported` kind + core classification posture
**Description:** Add the kind to the `RuntimeErrorKind` union with docstring semantics
("provider deterministically rejected the model id for this account — non-retryable").
Extend the exhaustive switches: `classifyDispatchError` → `structural`,
`classifyDispatchFailureDetail` → new `DispatchFailureReasonCode 'model_not_supported'`
(carrying provider/model from `providerInfo`), `formatSanitizedRuntimeFailure`, and the
retry policy in `dispatch-state.ts` → non-retryable.
**Acceptance:** union compiles everywhere (typecheck is the exhaustiveness proof); new kind
classifies structural + non-retryable; sanitized message names the model.
**Verify:** `bun test tests/core/dispatch-error-classification.test.ts tests/core/runtime-errors.test.ts --isolate`; `bun run lint`.
**Files:** `packages/core/src/adapters/runtime/errors.ts`, `src/core/dispatch-failures.ts`,
`src/core/dispatch-state.ts`, + 2 test files. **Size:** S. **Deps:** none.

#### Task 2: Pi classification + attribution fixes
**Description:** New ladder branch in `packages/adapter-pi/src/errors.ts` (after 401/403,
before transport): HTTP 400 + model-not-supported message shape → `model_not_supported`
with qualified `providerInfo.model` from ctx. Side-fix A: stream path passes `model` into
`toRuntimeError` and the terminal error chunk becomes `data: { kind, model }`. Side-fix B:
`codex-images.ts` throws attribute the (qualified) carrier model, not `CODEX_IMAGE_MODEL`.
**Acceptance:** the live incident's exact error shape (400 + "The 'X' model is not
supported…") classifies as `model_not_supported`; ambiguous 400 stays `runtime_failed`;
stream terminal error chunk carries `{ kind, model }`; carrier rejection names the carrier.
**Verify:** new `tests/adapter-pi/errors-classification.test.ts` (first direct
`toRuntimeError` coverage) + extend `tests/integration/pi/images-shim.test.ts`; check
runtime-conformance stream assertions still pass:
`bun test tests/adapter-pi/ tests/integration/runtime-conformance/ --isolate`.
**Files:** `packages/adapter-pi/src/{errors,messaging,codex-images}.ts` + 2 tests. **Size:** M. **Deps:** T1.

### Phase 2 — Durable evidence

#### Task 3: `model_rejections` ledger table + verbs
**Description:** Migration v9 per spec D2 (UNIQUE(model), reopen-on-conflict, partial index
on open status). Domain verbs in `packages/core/src/execution/ledger.ts`
(`recordModelRejection` upsert/reopen with occurrences++ and bounded detail,
`resolveModelRejection(model, resolution)`, `listModelRejections({ openOnly })`), re-exported
via `src/core/execution-ledger.ts`.
**Acceptance:** record→reopen debounces to one row with occurrences incremented;
resolve stamps `resolved_at`/`resolution`; list honors `openOnly`; `LedgerUnavailableError`
propagates (callers fail-open).
**Verify:** new `tests/core/model-rejections-ledger.test.ts` (real temp-dir ledger,
`closeDb()` before cleanup): `bun test tests/core/model-rejections-ledger.test.ts --isolate`.
**Files:** `ledger.ts`, `src/core/execution-ledger.ts`, 1 test. **Size:** S. **Deps:** none (parallel-safe with T1/T2).

#### Task 4: Facade recording wrapper
**Description:** New `src/core/model-availability.ts`: wraps the adapter returned by
`createRuntimeAdapter()` — `messaging.send`/`stream`, `images.generate`/`edit` (and
`models.probe` when present, forward-compatible with T8). Rejection edge: thrown
`model_not_supported` + `providerInfo.model`, or stream terminal error chunk
`data.kind === 'model_not_supported'` with `data.model` ⇒ best-effort
`recordModelRejection` + `appendAudit('model.rejected')`, error passes through untouched.
Success edge: explicit-model success ⇒ resolve-if-open + `appendAudit('model.rejection_resolved')`
only when a row flipped. Recording failures log-warn, never mask.
**Acceptance:** rejection recorded + rethrown byte-identical; stream chunks pass through
unchanged; explicit-model success resolves an open row; inherit-model success records
nothing; ledger-down alters no behavior.
**Verify:** new `tests/core/model-availability-wrapper.test.ts` with a mock adapter:
`bun test tests/core/model-availability-wrapper.test.ts --isolate`.
**Files:** `src/core/model-availability.ts` (new), `src/core/runtime-adapter-factory.ts`, 1 test. **Size:** M. **Deps:** T1, T3.

### CHECKPOINT A — passive pipeline complete
`bun run lint` + `bun run test` green. A `model_not_supported` failure anywhere
(dispatch/chat/system/images) now leaves a durable, audited ledger row that self-heals.

### Phase 3 — Consumption

#### Task 5: Availability overlay in the models plugin
**Description:** Per spec D4: `fetchAvailableModels` (and the `POST /refresh` handler,
which bypasses it) overlay open rejections on every read — `available: false` +
`metadata` rejection info. Caches written pre-overlay; responses post-overlay; ledger-down
⇒ overlay skipped.
**Acceptance:** a rejection recorded *after* a cache write is reflected on the next read
(no refresh needed); `available.json` never contains overlay state; flip-not-filter (row
present, flagged); ledger-down ⇒ all rows available.
**Verify:** extend `tests/plugins/models/models-cache.test.ts` (cache-served overlay, the
`withFreshTiers` template) + `tests/plugins/models/routes.test.ts` (/refresh ordering):
`bun test tests/plugins/models/ --isolate`.
**Files:** `plugins/models/lib/available-models.ts`, `plugins/models/lib/routes.ts`, 2 tests. **Size:** M. **Deps:** T3 (T4 for e2e meaning).

#### Task 6: Health evidence sharpening
**Description:** `RoutingHealthDeps` gains `listOpenModelRejections()`;
`route-model-missing-${workClass}` evidence distinguishes "not in catalog" vs "rejected by
account (N failures, last …)". Recommender needs no change (pool already excludes
`available === false` — assert it).
**Acceptance:** route → rejected model fires `action_required` with account-rejected
evidence; route → never-existed model keeps catalog-missing evidence; `recommendRoutes`
never proposes a rejected model (regression test for the post-#854 skill-mapping incident).
**Verify:** `bun test tests/plugins/models/health-checks.test.ts --isolate`.
**Files:** `plugins/models/lib/health-checks.ts`, both deps wirings
(`plugins/models/index.ts`, `lib/routes.ts`), 1 test. **Size:** S. **Deps:** T5.

#### Task 7: UI — rejected badge on Available Models
**Description:** The tab renders `available: false` rows (it has never seen one) with a
"Rejected by account · <date>" badge from row metadata. Load `bakin-ui-conformance` FIRST;
compose existing SDK patterns; no new component unless conformance demands it.
**Acceptance:** rejected row visibly badged, not hidden; healthy rows unchanged;
`bun run ui:conformance --quick` passes.
**Verify:** conformance quick mode + existing component tests:
`bun test tests/plugins/models/ --isolate`.
**Files:** `plugins/models/components/available-models-tab.tsx` (+ minor). **Size:** S. **Deps:** T5.

### CHECKPOINT B — detection layer live
Full gate green. Live-test window for Mark: reproduce a rejection (route a class to a dead
model id), watch Health + Available Models + recommender react within one failed turn.

### Phase 4 — Probe

#### Task 8: Optional `models.probe` on the runtime contract + Pi impl
**Description:** OPTIONAL `probe(modelId)` on the neutral models surface
(`concepts.ts` + SDK runtime type; feature-detect, no `.probe!.`). Pi implements a minimal
1-token completion, short timeout, returning success or throwing the typed error (so T4
records it). OpenClaw omits. Conformance: minimal mock omits probe; capability-honesty
check that consumers feature-detect.
**Acceptance:** Pi probe of a callable model resolves; dead model throws
`model_not_supported`; adapters without probe expose `undefined`.
**Verify:** `bun test tests/adapter-pi/ tests/integration/runtime-conformance/ --isolate`.
**Files:** `concepts.ts`, `packages/sdk/src/types/runtime.ts`,
`packages/adapter-pi/src/models.ts`, tests. **Size:** M. **Deps:** T1 (T4 wires recording).

#### Task 9: Probe-on-refresh
**Description:** `POST /refresh` accepts `{ probe?: boolean }` (default false — background
auto-refresh and the `models.refreshAvailableModels` hook stay probe-free). Probes only
configured-provider models, concurrency ≤3, per-model verdicts
(`verified | rejected | skipped`) in the response. UI: explicit "Verify availability"
action on the tab. Probe outcomes ride T4's wrapper into the ledger both directions.
**Acceptance:** probe:true probes exactly configured-provider models; probe success
resolves an open rejection; background refresh path provably never probes; no-probe
runtime reports all `skipped`.
**Verify:** `bun test tests/plugins/models/routes.test.ts --isolate` + conformance quick
for the UI action.
**Files:** `plugins/models/lib/routes.ts`, `available-models.ts` (probe orchestration),
UI action, tests. **Size:** M. **Deps:** T8, T4.

### Phase 5 — Carrier ladder

#### Task 10: Codex carrier fallback ladder
**Description:** Per spec D7: on `model_not_supported` from the carrier ONLY, ladder
configured → `DEFAULT_CARRIER_MODEL` → typed failure (attributed, recorded). Never ladder
on 429/401/5xx. `metadata.carrierModel` reports the rung that ran.
**Acceptance:** rung-1 rejection → rung-2 success with truthful metadata; 429 on rung 1 →
no ladder, cooldown error; both rungs rejected → typed error naming the last carrier;
each rejected rung produces evidence (via T2 attribution + T4 recording).
**Verify:** `bun test tests/integration/pi/images-shim.test.ts --isolate` (fetchImpl seam).
**Files:** `packages/adapter-pi/src/codex-images.ts`, `images.ts`, 1 test. **Size:** S. **Deps:** T2.

### Phase 6 — Docs + gate

#### Task 11: Docs coverage
**Description:** Per spec: `.claude/knowledge/{models-plugin,execution-ledger,runtime-capabilities,pi-adapter,dispatch}.md`
updates; CLAUDE.md one-liners (Models Cache + Catalog bullet); README.md reviewed
(expected no impact — confirm).
**Acceptance:** every shipped behavior findable in the knowledge doc that owns its system;
no doc references behavior that didn't ship.
**Verify:** manual read-through against the spec's D1–D7. **Size:** S. **Deps:** T1–T10.

#### Task 12: Final gate + PR
**Description:** `bun run lint`, `bun run test`, `bun run check:cycles` (if configured),
`ui:conformance --quick`. Optional `/verify` isolated-server pass for the refresh/probe/
overlay endpoints. Open PR referencing #852 + spec, with the live-test checklist for Mark
(test-live-before-merge). Close #852 after merge with proposals→shipped mapping.
**Verify:** all gates green; PR body maps commits → spec decisions. **Deps:** all.

### CHECKPOINT — complete
All spec success criteria (1–6) demonstrably met; Mark approves live; merge.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Classification pattern false-positives a live model | Med | Narrow shape (400 + explicit model-not-supported text) in the one sanctioned sniffing site; blocks nothing (advisory surfaces only); self-heals on next success; manual resolve exists |
| Conformance suite pins the stream chunk shape | Low | Chunk change is additive (`data.model`); run conformance in T2, adjust assertions additively |
| UI never rendered `available:false` rows — hidden assumptions | Low | T7 explicitly tests the state; conformance quick mode |
| Probe fires from background refresh by accident | Med | Default-false param, hook untouched; T9 has an explicit never-probes regression test |
| Ledger contention / boot cost | Low | Coordination-facts-only table, single-row upserts, partial index; same posture as budget_incidents |
| Migration on the live box while 3737 serves main | Low | Migration runs on next server start of the branch; forward-only and additive — main continues to run against the same db untouched |

## Parallelization

Single-session sequential build (T1→T12). If parallelized: {T1,T3} first wave; {T2,T4}
second; {T5-7}, {T8-9}, {T10} independent tracks after; T11-12 join.
