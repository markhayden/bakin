# Spec: Antfly 0.2.0 Adoption — Repin, De-Harden, Stabilize

Status: DRAFT (pending approval) · Owner: Mark Hayden · Date: 2026-08-30

## Objective

Adopt the official **antfly v0.2.0** release (published 2026-08-11), replacing the
`0.2.0-rc.18` pin that we deliberately held through the failed rc.19–rc.21 adoption
(reverted 2026-07-22, crash dossier filed upstream). Production-release quality:
remove every rc.18-era workaround whose upstream cause is verifiably fixed, prove
stability empirically — with **reindex-under-load as the crucible**, since reindex
is historically where the engine hurt us — and cut the dev box over.

**Deploy + verification target:** `roscoe@100.91.112.69` (Apple M4, macOS 26.6,
darwin-arm64; live `~/.bakin`, `io.bakin.antfly` launchd service currently running
rc.18 with the `swarm` subcommand; bakin runs from source at
`~/go/src/github.com/markhayden/bakin`). SSH key access is set up. The M4 matters:
the rc.21 R4 crash was a Metal command-buffer failure, so evaluation runs on the
real silicon. The box is a production-quality dev box — no meaningful data is at
risk; rollback stays deliberately simple.

### Why now

- All eight tracked upstream issues are closed: #317, #322, #350 (pre-release),
  #386 (2026-07-23), #384 (2026-08-03), #319 (2026-07-22, fix known *partial* at
  rc.21), and **#382 + #383 — closed 2026-08-30 by the maintainer with no closing
  comment, no linked commit, and no fix-version. Those two closures are unverified
  claims and are exactly what the hard gate exists to test.**
- Search data is fully derived (durable outbox + blue/green tables), so a
  version-change rebuild event costs a reindex, nothing more.

## The Hard Gate (Phase 0 — DECIDED)

Run the reproduction ladder against the **bare v0.2.0 binary** on roscoe —
ephemeral data dir + ports (3838-range, dev-rig pattern), live rc.18 service
untouched, shell + curl only, no Bakin code — **before any repo changes**:

- **R1–R3:** sequential write/read/query rungs (healthy on every version).
- **R4:** 3+ concurrent embed-bearing batch-write streams into embedding-leg
  tables, sustained **30–60 min** clean (rc.21 died in 51 s; launchd KeepAlive
  historically masked crashes as "wedging" — count process launches, don't just
  check liveness).
- **antfly#382:** sync-level `full_index` bad-media batch → verify plain-table
  reads do NOT flip to `error.ReadUnavailable` engine-wide.
- **antfly#383:** write with 0.2.0 → attempt read with rc.18 binary (and reverse)
  → document migration behavior; confirm whether a version gate/warning now exists.
- **antfly#386:** DROP a table with a hot embedding queue → engine survives.
- **rc.20 empty-dir case:** first boot + table create on an EMPTY data dir → no
  mid-create exit.
- **Reindex crucible (bare):** continuous queries during a large backfill —
  latency, availability, and honest degrade recorded.

**Any rung fails → full stop.** Stay on rc.18, file counter-evidence upstream
(shell-only repros, dossier pattern), and the deliverable is the evidence file.
Evidence lands in `tasks/evidence-antfly-0.2.0.md` (GATE A/B evidence-file
pattern from `tasks/evidence-search-trust-and-speed.md`).

Also verified empirically at this phase (never trusted from notes): the server
subcommand name on the final binary (`standalone` per the rc.19 rename — but the
0.2.0 monorepo migration and its "single-node swarm mode" operator language make
this worth 30 seconds of `--help`), the wire shapes (`filter_query`+`match_phrase`,
`order_by` on inferred fields, `/documents` body requirement, `timeout_ms`→504,
totals), the `/ml/v1/*` API move's impact on our raw-fetch client, model
distribution compatibility (for `model-pins.ts`), and the wedge-pattern log
strings (`catch-up debt persists` et al. — a silent rewording blinds
`engine-status.ts`).

## Scope

**In scope:** the repin; forced wire-contract changes; removal of every workaround
whose pin flips red against 0.2.0; the serialization-gate and #319-override
removals behind their dedicated soaks; chaos-drill re-run; cutover on roscoe;
before/after reindex performance evidence; docs/knowledge sweep; follow-up
enhancement tickets.

**Judgment scope (integrate only if it serves flip-and-stabilize):** new 0.2.0
features — AFB portable backup/restore, `/ml/v1/*` surface, fallback algebraic
bucket aggregations, secrets live-rotation. Deep-dive survey happens; anything not
rolled in becomes a drafted enhancement ticket in the bakin repo (`gh`), including
performance opportunities found during evaluation.

**Out of scope:** rollback architecture beyond binary-swap (decided: keep the
rc.18 binary parked under a suffixed name in `~/.antfly/bin`; rollback = swap
binary, re-provision `swarm` plist, wipe data dir, repair reindex); backwards
compatibility or shims of any kind; changes to the adapter-neutral search
contract (D17 boundary holds — antfly identifiers stay behind the adapter).

## De-Hardening Candidates (Phase 3 — one commit each)

Each removal is gated on its regression pin in
`tests/integration/antfly/workaround-regressions.test.ts` actually failing
against the 0.2.0 binary (the suite's fails-when-fixed contract). Pins that stay
green mean still-broken upstream: workaround stays, comment updated, fresh
upstream ticket filed. Ordered least-risky first:

1. `composeFtsWithFilters` in `translate.ts` (if `filter_query`+`match_phrase` fixed)
2. The `!runtime` empty-table idle block in `mapIndexStatuses`
3. `EMBED_SAFE_RE` + thumbs-first media guard (if undecodable `media_url` no
   longer poisons whole batches — also re-check the rc.20 `ReadUnavailable`-storm
   heal path pinned in the same test)
4. rc.20-era `read-unavailable-storm` wedge pattern in `engine-status.ts` (if #382 holds)
5. `order_by`/sort enablement for inferred fields (pin at line 90, if fixed)
6. `/documents` bodyless-request workaround (if fixed)
7. **antfly#319 idle-detection override** (health mapping) — marked
  retirement-is-MANUAL; small corpora can't reproduce. Requires a scale repro
  (mixed corpus with skipped docs) during evaluation + the 48 h burn-in verdict.
8. **Process-wide single-write serialization gate** in `client.ts` (direct product
  of R4) — LAST, behind the bare-engine soak plus a Bakin-level concurrent-write
  soak. Biggest perf win (concurrent backfills), biggest risk. Capture reindex
  throughput before/after as evidence.

**Not workarounds — untouched:** durable outbox, blue/green versioned tables,
migration pump, query budget/degrade honesty, wedge watchdog itself, doctor
checks. That's architecture.

## Tech Stack

Unchanged: Bun ≥1.2.0 (pinned 1.3.13), TypeScript strict, Zod at boundaries.
Antfly v0.2.0 (zig runtime) as an OS-supervised service on `127.0.0.1:3738`,
raw-fetch HTTP client, pinned + SHA256-verified direct download from
`https://releases.antfly.io/antfly/v0.2.0/` (checksums verified live:
`antfly_zig_checksums.txt` — Darwin_arm64 `82690d5c…`, Linux_arm64 `a4993e85…`,
Linux_x86_64 `1eb63abb…`; re-fetch at pin time, don't copy from this spec).

## Commands

```
bun run test:ci                                  # canonical CI invocation (gate for every commit)
bun test tests/integration/antfly/ --isolate      # workaround pins + integration (needs binary)
bun test tests/adapter-antfly/ --isolate          # service/installer/model-pin units
bun run typecheck                                 # gate for every commit
bun run instance up --mode isolated               # dev-rig, isolated antfly on 3838
bun run dev:chaos                                 # scripts/dev/search-chaos-drills.ts (five drills)
bakin install search                              # cutover: download+verify+swap+wipe+provision
bakin reindex                                     # repair-by-default rebuild
bakin check search && bakin doctor                # post-cutover health
BAKIN_ANTFLY_BIN=<path> BAKIN_ANTFLY_SUBCOMMAND=<sub> bun test tests/integration/search-conformance/ --isolate
```

Remote execution on roscoe over SSH (`ssh roscoe@100.91.112.69`); evaluation
engines run as children with ephemeral data dirs, never touching the live
launchd unit (the 2026-07-11 hijack lesson: guest-URL settings for any
Bakin-driven eval instance).

## Project Structure (files this effort touches)

```
packages/adapter-antfly/src/pin.ts            — version, checksums, recipe comment (source of truth)
packages/adapter-antfly/src/model-pins.ts     — re-verify distributions + hashes, SAME commit as pin
packages/adapter-antfly/src/service.ts        — swarm→standalone argv + comment (:136-161)
packages/adapter-antfly/src/{wire,translate,client,engine-status,server-logs}.ts — wire probes, de-hardening
scripts/instance/antfly-child.ts:33           — subcommand
scripts/dev/search-chaos-drills.ts:71         — subcommand
tests/integration/antfly/workaround-regressions.test.ts — pin flips/deletions
tests/integration/search-conformance/harness.ts:126-129 — default subcommand, version guard
tests/adapter-antfly/service.test.ts, tests/scripts/instance/antfly-child.test.ts — argv mirrors
tests/architecture/adapter-boundary.test.ts:84 — `antfly\s+swarm` banned-identifier regex
tests/core/onboarding/antfly.test.ts          — NOT touched (synthetic fixture pin, decoupled by design)
tasks/evidence-antfly-0.2.0.md                — NEW: gate + soak + perf evidence
CLAUDE.md:21                                  — the Search bullet (pin, revert note, subcommand, open pins)
.claude/knowledge/search-system.md            — install lines, rebuild-event section, wire-contract facts (~:37-40, 221-227, 495-551)
.claude/knowledge/multimodal-search.md:60-67  — #319 section
.claude/knowledge/search-chaos-drills.md      — re-run record + engine line
CHANGELOG.md                                  — release entry
docs/src/content/docs/start/operation.md      — engine data-dir guidance if wording is impacted
```

README.md: check for impact; its `BAKIN_VERSION=v0.0.1-rc.20` is the *Bakin*
release pin (known-stale, unrelated) — fix only if trivially in-path, otherwise
note it in the follow-ups ticket.

## Code Style

Match existing adapter code. Example — the shape of a pin flip when upstream
fixes something (from the suite's own contract):

```typescript
// BEFORE (PIN — fails when upstream fixes it):
test('PIN: filter_query rejects match_phrase with 400', async () => {
  const res = await rawQuery(table, { filter_query: MATCH_PHRASE_FILTER })
  expect(res.status).toBe(400) // antfly#… — delete composeFtsWithFilters when this flips
})

// AFTER (workaround deleted in the same commit; GUARD keeps the fixed behavior honest):
test('GUARD: filter_query accepts match_phrase (fixed in 0.2.0)', async () => {
  const res = await rawQuery(table, { filter_query: MATCH_PHRASE_FILTER })
  expect(res.status).toBe(200)
})
```

Conventions: conventional commits with scope; `kebab-case.ts`; no empty catches;
comments state constraints (upstream issue numbers on every remaining
workaround), never narration.

## Testing Strategy

Layered, strictest-reality last:

1. **Bare-engine gate + soak** (Phase 0, roscoe): the hard gate above. Shell-only
   so results are upstream-filable verbatim.
2. **Unit/architecture** (every commit): `bun run test:ci` + `typecheck` green
   before the next commit starts — no fix-up commits.
3. **Integration vs real binary** (post-repin): `tests/integration/antfly/` +
   search-conformance + golden queries, run with the 0.2.0 binary via
   `BAKIN_ANTFLY_BIN`. The harness's version guard must be satisfied honestly
   (it exists because GATE B once certified a stale engine).
4. **Chaos drills**: all five re-run against 0.2.0; record in the knowledge doc.
5. **Reindex crucible** (bare + full stack): sustained query load DURING full
   reindexes; assert availability (no silent stalls, honest `meta.partial`),
   record latency percentiles + reindex wall-time vs rc.18 baseline. Run before
   AND after the serialization-gate removal to quantify the win.
6. **Post-cutover on roscoe**: `bakin install search` → full repair reindex on
   the real corpus → doctor fully green (`search-spin`, `search-engine-watch`,
   freshness/backlog) → ⌘K spot-checks across content types.
7. **48 h burn-in**: normal operation; check launchd launch counts + server logs
   for silent respawns; decides the #319-override retirement. Effort closes only
   after burn-in passes.

Testing rules from CLAUDE.md apply throughout (temp-dir mocks, `--isolate`, no
`~/.bakin` leaks). No new test infrastructure invented — extend the existing
harness, drills, and evidence-file patterns.

## Commit Strategy (DECIDED)

Single branch `feat/antfly-0.2.0-adoption`, one PR, commits as rollback checkpoints:

1. `test(search): record antfly 0.2.0 evaluation evidence` — evidence file only.
   If the gate fails, this is the whole deliverable.
2. `feat(search)!: repin antfly 0.2.0-rc.18 → 0.2.0` — pin + checksums +
   subcommand at all three spawn sites + test mirrors + arch-regex + model-pins
   re-verify + forced wire changes. **System fully working with all workarounds
   intact — master rollback checkpoint.**
3. `refactor(search): drop <workaround> — fixed upstream in 0.2.0` — one per
   workaround, ordered as listed above, each with its pin flip/deletion.
4. `docs(search): sweep knowledge + CLAUDE.md + changelog for the 0.2.0 pin`.
5. Post-merge: cutover on roscoe from main; enhancement/still-broken tickets
   filed via `gh`.

## Boundaries

**Always:**
- `bun run test:ci` + `bun run typecheck` green before every commit lands.
- Re-fetch checksums from the release's `antfly_zig_checksums.txt` at pin time;
  verify the installed binary's `--version` before trusting any test result
  (stale-engine lesson).
- Keep the rc.18 binary parked on roscoe under a suffixed name until burn-in passes.
- Evidence for every gate verdict in `tasks/evidence-antfly-0.2.0.md`; upstream
  issue number on every workaround that survives.
- Update knowledge docs in the same PR as the behavior they describe.
- Bare-engine evaluation uses ephemeral data dirs/ports; guest-URL settings for
  any Bakin-driven eval instance (never re-provision the live launchd unit from
  an eval).

**Ask first:**
- Proceeding past a FAILED gate rung in any form.
- Removing the serialization gate or the #319 override if their soak evidence is
  ambiguous rather than clean.
- Rolling an optional 0.2.0 feature into scope (per the judgment-scope rule).
- Any change to the adapter-neutral search contract or D17 boundary.
- Cutover timing on roscoe (it interrupts live search while reindexing).

**Never:**
- Trust upstream issue-closed state without a local repro (#382/#383 especially).
- Backcompat shims, dual-version support, or a config flag to re-enable a
  removed workaround.
- Hand-edit the live plist or `settings.json` on roscoe — `bakin install search`
  owns provisioning.
- Delete a still-green pin, or weaken a test to make a removal pass.
- `git add -A` after a local build (build-stamp trap); commit generated
  artifacts per the full-build-chain rule.

## Success Criteria

1. Gate evidence file exists with a verdict on every rung; all rungs PASS
   (else: effort correctly stops at commit 1 + upstream counter-evidence filed).
2. Pin at 0.2.0 with verified checksums; all three spawn sites + test mirrors +
   arch regex agree on the empirically-verified subcommand.
3. Every de-hardening candidate resolved: removed (pin flipped → guard) or
   retained with updated comment + fresh upstream ticket. Zero pins asserting
   behavior 0.2.0 no longer exhibits.
4. `bun run test:ci`, typecheck, integration suites, conformance + goldens, and
   all five chaos drills green against the 0.2.0 binary.
5. Reindex crucible evidence recorded: search remained available (honest
   degrades only) under sustained query load during full reindexes, with
   before/after latency + throughput numbers vs rc.18.
6. roscoe cut over: 0.2.0 live under launchd, full repair reindex complete,
   doctor fully green, rc.18 binary parked for rollback.
7. 48 h burn-in clean (no silent respawns, no wedge findings, no spin), closing
   the #319-override question with evidence.
8. Docs sweep complete (CLAUDE.md Search bullet, search-system.md wire facts,
   multimodal-search.md, chaos-drills record, CHANGELOG); README checked.
9. Follow-up enhancement tickets filed for unadopted 0.2.0 features + any
   still-broken upstream behavior.

## Open Questions (resolved empirically in Phase 0, not blockers)

- Actual subcommand name on the 0.2.0 binary (`standalone` expected; verify).
- Whether the `/ml/v1/*` move touches any path our raw-fetch client calls.
- Whether 0.2.0's model distributions match `model-pins.ts` hashes.
- Whether #382/#383 closures reflect real fixes (the gate's core question).
- Whether a scale repro can be built for #319 (determines override retirement
  path: evidence-based removal vs burn-in-based).
