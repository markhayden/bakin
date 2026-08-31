# Implementation Plan: Antfly 0.2.0 Adoption

Spec: `SPEC.md` (approved 2026-08-30). Evidence: `tasks/evidence-antfly-0.2.0.md`.
Task list: `tasks/todo-antfly-020-adoption.md`.

## Overview

Adopt antfly v0.2.0 behind a hard evaluation gate, remove every rc.18-era
workaround whose upstream fix is locally proven, validate with reindex-under-load
as the crucible, cut over `roscoe@100.91.112.69`, and close after a 48 h burn-in.
Single branch `feat/antfly-0.2.0-adoption`, one PR, commits = rollback checkpoints.

## Architecture Decisions (from the spec interview)

- **Hard gate:** bare-engine ladder on roscoe BEFORE any repo change; any rung
  fails → stop, evidence + upstream counter-tickets are the deliverable.
- **Staged de-hardening:** one workaround per commit, each gated on its
  regression pin flipping red against 0.2.0; serialization gate last, behind a
  dedicated soak. Still-green pin = workaround stays + fresh upstream ticket.
- **Simple rollback:** rc.18 binary parked on roscoe; swap + `swarm` plist +
  wipe + reindex. No dual-version machinery, no shims, no re-enable flags.
- **Judgment scope on new features:** integrate only what serves
  flip-and-stabilize; everything else → `gh` enhancement tickets.
- **Evaluation isolation:** ephemeral data dirs + 3838-range ports, guest-URL
  settings for any Bakin-driven instance; the live launchd unit is never touched
  until cutover (2026-07-11 hijack lesson).

## Dependency Graph

```
P0 gate (roscoe, bare engine, evidence only)
 ├─ T1 stage binary + empirical probes ──┐
 ├─ T2 R1–R3 + empty-dir boot            │ probes feed T8 (wire/subcommand facts)
 ├─ T3 R4 concurrency soak               │ T3 feeds T15 (serialization removal)
 ├─ T4 #382 poison-read + #386 hot-drop  │ T4 feeds T13/T14
 ├─ T5 #383 version round-trip           │ T5 confirms rebuild-event handling
 ├─ T6 bare reindex crucible + rc.18 baseline ─ feeds T15 before/after numbers
 └─ T7 #319 scale-repro attempt ───────── feeds T16 (override retirement path)
      ↓ GATE VERDICT (human checkpoint, commit 1)
P1 repin (commit 2): T8 pin/subcommand/model-pins/mirrors → T9 full suites green
      ↓ master rollback checkpoint
P2 de-hardening (commits 3a–3f): T10 pin census → T11..T16 one removal each
P3 docs + survey (commit 4): T17 docs sweep, T18 feature deep-dive + ticket drafts
P4 full-stack validation: T19 chaos drills, T20 rig e2e + full-stack crucible
      ↓ PR review/merge (human checkpoint)
P5 cutover + burn-in: T21 cutover → T22 post-cutover verify → T23 48 h burn-in
      ↓ close: T24 file tickets, final evidence, #319 verdict
```

High-risk work is earliest (T3/T4 are exactly what killed rc.21). Every phase
leaves the system working; P2 tasks are independently revertible commits.

## Phases and Checkpoints

### Phase 0 — The Hard Gate (roscoe, no repo code; evidence file only)

Tasks T1–T7. All engine runs use `~/eval-antfly-020/` ephemeral data dirs,
ports 3838/3839, shell + curl only (upstream-filable repros). The live rc.18
service keeps running untouched. rc.18 baseline runs (T6) use a second
ephemeral instance, never the live one.

**Checkpoint GATE (human):** every rung has a PASS/FAIL verdict in the evidence
file. Commit 1 lands either way. FAIL on any rung → stop; deliverable becomes
counter-evidence + upstream tickets. PASS → proceed to P1.

### Phase 1 — Repin (commit 2)

T8 (all pin/subcommand/mirror/model-pin edits + forced wire changes, one
commit) then T9 (every suite green vs the 0.2.0 binary). Local test runs use
`BAKIN_ANTFLY_BIN` pointed at a locally staged 0.2.0 binary — never
`bakin install search` on the laptop (stale-binary + LaunchAgent-bootout traps
are known memories). Harness version guard must pass honestly.

**Checkpoint REPIN:** `bun run test:ci` + typecheck + integration/conformance/
goldens green. System fully working with all workarounds intact — the master
rollback point.

### Phase 2 — De-Hardening (commits 3a…, one per candidate)

T10 runs the workaround-pin suite against 0.2.0 and produces the flip census —
the authoritative worklist. Then per candidate (ordered least-risky first, per
spec): delete workaround + flip PIN→GUARD + full suite green + commit. A
still-green pin closes the candidate as "retained" with an updated comment and
a drafted upstream ticket (filed in P5).

Serialization-gate removal (T15) additionally requires: T3 soak clean, a
Bakin-level concurrent-write soak, and before/after reindex-throughput numbers
recorded in the evidence file. #319 override (T16) requires T7's scale repro to
have reproduced-then-cleared; otherwise it is explicitly deferred to the
burn-in verdict (T23) and does NOT land in this PR.

**Checkpoint DEHARDEN:** zero pins asserting behavior 0.2.0 doesn't exhibit;
every candidate resolved removed/retained/deferred; suite green.

### Phase 3 — Docs + New-Feature Survey (commit 4)

T17: docs sweep per the spec's file map (CLAUDE.md Search bullet,
search-system.md §install/§rebuild-event/§wire-facts, multimodal-search.md #319
section, chaos-drills record, CHANGELOG entry, operation.md wording check,
README impact check). T18: deep-dive on AFB backup/restore, `/ml/v1/*`,
aggregations, secrets rotation → integration-worthiness verdict each + drafted
enhancement tickets (text in evidence file; filed in P5).

### Phase 4 — Full-Stack Validation (pre-merge)

T19: five chaos drills vs 0.2.0. T20: isolated dev-rig boot
(`instance up --mode isolated`), real corpus-ish seed, full-stack reindex
crucible — sustained ⌘K/API query load during `bakin reindex --force`, assert
availability + honest degrades, record latencies.

**Checkpoint PR (human):** branch pushed, PR open, CI green. Merge decision.

### Phase 5 — Cutover + Burn-In (post-merge, roscoe)

T21: park rc.18 binary → pull main → restart bakin server → `bakin install
search` (downloads 0.2.0, wipes data dir, re-provisions plist, restarts) →
`bakin reindex` → watch to completion. Ask-first on timing (interrupts live
search). T22: doctor fully green, conformance spot-checks against live engine
read-only, ⌘K checks across content types, launchctl launch-count baseline.
T23: 48 h burn-in — scheduled checks of launch counts, server.log, doctor,
spin/wedge watchdogs; decides deferred #319 override. T24: file all drafted
tickets via `gh`, final evidence update, close.

**Checkpoint CLOSE (human):** burn-in verdict + success criteria 1–9 from SPEC.md.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| #382/#383 closed upstream without real fixes | High | That IS the gate (T4/T5); fail → stop |
| R4 crash only manifests past 60 min | High | Launch-count monitoring, not liveness; 48 h burn-in as backstop |
| Subcommand/wire surprises in monorepo'd 0.2.0 | Med | T1 empirical probes before any repo edit |
| Model distributions changed → embed legs dead | Med | T1 probes model compat; model-pins re-verified in commit 2 |
| Serialization removal destabilizes under real load | High | Last commit, own soak, surgical revert, burn-in watches it |
| Harness certifies a stale engine | Med | Version guard + explicit `--version` check in every run log |
| Local laptop antfly state corrupted by testing | Low | `BAKIN_ANTFLY_BIN` only; never `install search` locally |
| roscoe repo has dirty build-stamp / behind main | Low | Clean/stash before pull at T21; never `git add -A` |
| bun 1.3.13 pin / CI divergence | Low | `bun run test:ci` locally before push |

## Parallelization

- T3 (30–60 min soak) runs in background while T4/T5/T6 execute on separate
  ephemeral instances — different ports/data dirs, same box; CPU contention is
  acceptable (it's load, which we want).
- P2 removal tasks are sequential by design (each commit green before next).
- T17/T18 can overlap with T19/T20.

## Open Questions

Carried from SPEC.md; all resolve inside T1/T7, none block starting P0.
