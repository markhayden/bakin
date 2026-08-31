# Todo: Antfly 0.2.0 Adoption

Plan: `tasks/plan-antfly-020-adoption.md` · Spec: `SPEC.md` · Evidence: `tasks/evidence-antfly-0.2.0.md`

## Phase 0 — Hard Gate (roscoe, bare engine, evidence only)

- [x] **T1: Stage binary + empirical probes** (S)
  - Acceptance: 0.2.0 tarball downloaded on roscoe, SHA256 verified against the
    `v0.2.0` path's `antfly_zig_checksums.txt`; `--version` output recorded;
    actual server subcommand discovered from `--help`; wire probes recorded
    (filter_query+match_phrase, order_by inferred field, /documents body,
    timeout_ms→504, totals shape, /ml/v1 impact); model-distribution compat
    vs `model-pins.ts` hashes checked; log strings for `WEDGE_PATTERNS` grepped
    from the binary.
  - Verify: every probe has a raw request/response snippet in the evidence file.
  - Deps: none. Files: `tasks/evidence-antfly-0.2.0.md` (new).

- [x] **T2: Ladder R1–R3 + empty-dir boot** (S)
  - Acceptance: sequential write/read/query rungs pass; first boot + table
    create on an EMPTY data dir completes (rc.20 killer).
  - Verify: transcripts in evidence file. Deps: T1.

- [x] **T3: R4 concurrency soak** (M)
  - Acceptance: 3+ concurrent embed-bearing batch-write streams into
    embedding-leg tables, 30–60 min, zero crashes/respawns — verified by
    process launch count + log scan, not liveness.
  - Verify: soak script + counts in evidence file. Deps: T2. Runs in background
    alongside T4–T6 (separate instances).

- [x] **T4: #382 poison-read + #386 hot-queue drop repros** (S)
  - Acceptance: full_index bad-media batch does NOT flip unrelated reads to
    ReadUnavailable; DROP of a table with hot embedding queue survives.
  - Verify: repro transcripts (mirroring the 2026-07-22 upstream comment shape).
  - Deps: T2.

- [x] **T5: #383 version round-trip** (S)
  - Acceptance: documented behavior for 0.2.0-written data read by rc.18 and
    reverse; version gate/warning presence recorded; rebuild-event assumption
    (wipe on version change) confirmed still correct.
  - Verify: transcript. Deps: T2 (uses parked rc.18 binary).

- [x] **T6: Bare reindex crucible + rc.18 baseline** (M)
  - Acceptance: sustained query load during a large backfill on 0.2.0 AND on an
    ephemeral rc.18 instance; latency percentiles, availability, degrade
    honesty recorded for both.
  - Verify: numbers table in evidence file. Deps: T2.

- [x] **T7: #319 scale-repro attempt** (M)
  - Acceptance: mixed corpus with template-skipped docs at enough scale to have
    reproduced the stuck-backfill on rc.18; verdict = reproduced-then-clean on
    0.2.0 / not-reproducible / still-broken.
  - Verify: corpus recipe + flag readings in evidence file. Deps: T2.

### CHECKPOINT GATE (human)
- [x] Every rung has a PASS/FAIL verdict; **commit 1**
  `test(search): record antfly 0.2.0 evaluation evidence` on branch
  `feat/antfly-0.2.0-adoption`.
- [x] Gate PASSED — no stop; proceeded to P1: counter-evidence + upstream tickets, effort ends.

## Phase 1 — Repin

- [x] **T8: The repin commit** (M)
  - Acceptance: `pin.ts` version+checksums+comment rewritten; subcommand flipped
    at `service.ts`, `antfly-child.ts`, `search-chaos-drills.ts` + harness
    default + `service.test.ts` / `antfly-child.test.ts` argv assertions +
    `adapter-boundary.test.ts` regex; `model-pins.ts` re-verified same commit;
    forced wire changes from T1 applied (`wire.ts`/`translate.ts`/`client.ts`);
    `engine-status.ts` + `server-logs.ts` strings re-baselined from T1 probes.
  - Verify: `bun run typecheck && bun run test:ci`. Deps: GATE.

- [x] **T9: Full suites vs 0.2.0 binary** (S)
  - Acceptance: `tests/integration/antfly/`, search-conformance + goldens green
    with `BAKIN_ANTFLY_BIN` → staged 0.2.0 (harness version guard passes
    honestly); expected: some workaround PINs now red — recorded as the T10
    census input, NOT fixed here.
  - Verify: run logs in evidence file; **commit 2**
    `feat(search)!: repin antfly 0.2.0-rc.18 → 0.2.0` (commit with pins listed
    as known-red in the message, or land T10's census first if suite policy
    requires green — decide at execution, suite-green wins).
  - Deps: T8.

### CHECKPOINT REPIN — master rollback point
- [x] test:ci + typecheck + integration green; system works with all workarounds.

## Phase 2 — De-Hardening (one commit per candidate)

- [x] **T10: Pin-flip census** (XS) — run workaround-regressions vs 0.2.0;
  table of flipped/held pins in evidence file. This is the authoritative
  worklist; candidates below close as "retained" if their pin held. Deps: T9.
- [x] **T11: composeFtsWithFilters removal** (S) — if filter_query fixed.
  PIN→GUARD, delete workaround in `translate.ts`. Verify: suite + conformance.
- [x] **T12: mapIndexStatuses `!runtime` idle block removal** (S) — empty-table
  flags now honest. PIN→GUARD.
- [x] **T13: EMBED_SAFE_RE + thumbs-first removal** (M) — if undecodable media
  no longer poisons batches; includes rc.20 ReadUnavailable-heal pin rework.
- [x] **T14: read-unavailable-storm wedge pattern removal** (S) — if #382 holds
  (T4); `engine-status.ts` + its tests.
- [x] **T15: Serialization-gate removal** (M) — LAST. Requires: T3 clean +
  Bakin-level concurrent-write soak (rig) + before/after reindex throughput
  recorded. Delete process-wide write gate in `client.ts`.
- [x] **T16: #319 idle-override resolution** (S) — remove ONLY if T7 verdict is
  reproduced-then-clean; else mark deferred-to-burn-in in code comment +
  evidence, revisit at T23.
- [x] Also from census: order_by/sort enablement, /documents body — fold into
  the list above as their pins dictate (same one-commit rule).

### CHECKPOINT DEHARDEN
- [x] Zero stale pins; every candidate removed/retained/deferred; test:ci green.

## Phase 3 — Docs + Survey

- [x] **T17: Docs sweep** (M) — **commit 4**: CLAUDE.md Search bullet;
  search-system.md (§37-40 install, §221-227 rebuild event, §495-551 wire
  facts); multimodal-search.md #319; search-chaos-drills.md re-run record;
  CHANGELOG entry; operation.md wording check; README impact check.
  Verify: every doc claim matches a T1–T16 evidence entry.
- [x] **T18: New-feature deep dive** (M) — AFB backup/restore, /ml/v1,
  aggregations, secrets rotation: integrate-vs-ticket verdict each (spec
  judgment rule); ticket drafts written into evidence file. Ask-first if any
  integration is proposed.

## Phase 4 — Full-Stack Validation

- [x] **T19: Chaos drills** (S) — all five vs 0.2.0; knowledge doc updated.
- [x] **T20: Rig e2e + full-stack reindex crucible** (M) — isolated instance,
  seeded corpus, sustained query load during `bakin reindex --force`;
  availability + honest degrades + latencies recorded.

### CHECKPOINT PR (human)
- [x] Branch pushed, PR open, CI green → merge decision.

## Phase 5 — Cutover + Burn-In (roscoe, post-merge)

- [ ] **T21: Cutover** (S) — ASK FIRST on timing. Park rc.18 binary
  (`antfly.rc18-parked`), clean repo state, pull main, restart server,
  `bakin install search`, `bakin reindex`, watch to completion.
- [ ] **T22: Post-cutover verify** (S) — doctor fully green (search-spin,
  engine-watch, freshness/backlog); read-only conformance spot-checks; ⌘K
  checks across content types; launchctl launch-count baseline recorded.
- [ ] **T23: 48 h burn-in** (S + elapsed time) — scheduled checks: launch
  counts, server.log scan, doctor, spin/wedge. Decides deferred T16.
- [ ] **T24: Close-out** (S) — file drafted tickets via `gh` (enhancements +
  still-broken upstream), final evidence update, SPEC success criteria 1–9
  checked off, delete/park SPEC.md per repo convention.

### CHECKPOINT CLOSE (human)
- [ ] Burn-in verdict + all SPEC.md success criteria met.
