# Spec: First-Class Embedding-Activity Signals (#847)

W3 of the antfly/search follow-up arc.

## Objective

Replace inference with declaration where 0.2.2 provides first-class signals —
in the agreed scope (Mark's decision): **the spin watchdog and every evidence/
narration surface consume the new signals; the blue/green FLIP decision keeps
count-based convergence** (engine self-reporting doesn't get flip authority
one week into the pin).

New per-leg surfaces (verified live on the box):
`status.activity` (phase, last_progress_at, batch counters), `readiness`
(state/queryable/complete/pending_reasons), `milestones` (named blockers),
`publication` (target_vectors/searchable_vectors), runtime `stalled` +
`stall_reason`, `active_progress_completed/total`, `last_progress_ms`.

## Scope

1. **Spin watchdog** (`plugins/health/lib/system-checks/search-spin.ts` +
   whatever feeds it): trigger on engine-declared `stalled === true` OR the
   existing zero-progress inference — strictly more sensitive; `stall_reason`
   joins the incident evidence.
2. **Convergence/park evidence** (`packages/core/src/search/tables.ts` park
   paths): parks record `activity.phase`, progress fraction
   (`active_progress_completed/total`), `readiness.pending_reasons`, and
   `milestones` blockers in the park log/registry evidence. DECISION LOGIC
   UNCHANGED (counts still decide).
3. **Health backlog evidence** (`health.search` / `getSearchHealth` legs):
   per-leg progress fraction + `stall_reason` when present ride the existing
   leg shape (additive optional fields, same annotation pattern as #845).
4. **Reindex CLI narration**: phase names from `activity.phase` when
   available.

Wire plumbing: extend `WireIndexStatusEntry` + `mapIndexStatuses` →
`TableLegHealth` optional fields (`progress?: { completed, total }`,
`stallReason?: string`, `phase?: string`). Adapter-neutral names, no antfly
identifiers upstream (D17).

Non-goals: no flip-authority change, no new endpoints, no UI beyond existing
evidence rendering.

## Commands / Structure / Style

As W1/W2 (bun test targeted suites, typecheck, lint; adapter tests in
`tests/adapter-antfly/translate.test.ts`, spin tests in
`tests/plugins/health/`, tables tests in `tests/core/search-tables.test.ts`).

## Testing Strategy

- translate matrix: new fields mapped when present, absent otherwise.
- spin check: `stalled:true` fires the incident even when doc counts moved
  (the case count-inference misses); `stall_reason` lands in evidence.
- tables: a park records the new evidence fields (fixture adapter serves
  them); flip behavior byte-identical with and without the new fields.
- Live pass: trigger `bakin reindex` of one small table; CLI narrates phases;
  doctor evidence carries progress fields.

## Boundaries

- Always: additive optional fields only; Unknown-never-healthy; counts decide
  flips.
- Ask first: ANY change to park/flip decision inputs.
- Never: antfly-specific names in packages/core; engine self-reports as flip
  evidence.

## Commit Strategy

Branch `feat/search-embedding-activity-847`, three commits:
1. wire + translate + TableLegHealth optional fields (+ matrix tests)
2. spin watchdog stalled-trigger + evidence (+ tests)
3. park/health/CLI evidence + narration (+ tests, knowledge notes)

## Success Criteria

- A stalled-but-count-moving leg fires the spin incident with `stall_reason`.
- Park logs carry phase/progress/pending_reasons; flip tests unchanged.
- Targeted suites + typecheck + lint green.

## Open Questions

None — depth decided in the kickoff interview.
