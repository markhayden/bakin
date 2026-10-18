# Plan: Quick wins — #855, #758, #898 (A–I)

Spec: `.claude/specs/quick-wins-855-758-898.md` (decisions D-A1 … D-E1).
Status: DRAFT for owner review (2026-10-16) — Codex plan review folded in (14 findings, all addressed).

## Ground rules (every PR)

- One branch per PR off fresh `main`, in the MAIN checkout (3737 serves it
  for live testing). Verify `git rev-parse --abbrev-ref HEAD` before every
  commit.
- PRs are sequential: the next branch starts from `main` after the owner
  merges the previous one. If the owner wants to keep moving before a
  merge, the next branch stacks on the previous one and is rebased after
  the merge.
- Conventional commits with scope; each commit compiles, passes its
  focused tests, and is independently revertable. Attribution line on
  every commit.
- **Per-PR gate, in order (never two full suites at once):**
  1. `bun run typecheck` · `bun run lint` · `bun run check:cycles`
  2. focused files: `bun test <files> --isolate`
  3. `bun run test` (full suite)
  4. UI PRs only: `bun run ui:conformance --quick`, then `--full` before
     handoff; plugin browser fixtures run as `bun run --cwd plugins/<id> test:ui`
  5. `/verify` isolated boot (port 3799, throwaway `BAKIN_HOME`); after
     `bun run build:assets-manifest`, `git checkout -- packages/host/src/api/_embedded-assets-static.ts`
     (never committed); kill by port
- **Codex review per PR** before marking ready:
  `codex exec --sandbox read-only -C <repo> - < prompt.md` with the branch
  diff (`git diff main...HEAD`) and the spec section. Every finding is
  verified against the code; real ones are fixed in a `fix(<scope>): …
  (review)` commit, false ones are noted in the PR body.
- PR opened ready (drafts skip CI), body ends with the Claude Code line,
  references the issue (`Closes #855`, `Closes #758`, `Closes #898` on the
  LAST #898 PR — E; earlier ones say "Part of #898").
- Docs: every PR checks `.claude/knowledge/` + user docs for its area and
  updates them in its own `docs(...)` commit; README only if a user-facing
  command or behavior it lists changes.
- No release. Merge only on the owner's approval.

## Dependency graph

```
A (#855) ── independent
B (#758) ── independent
C (#898 narrow) ── ack/request validation ─┐
H (approvals) ── actor guard ───────────────┼─> G (coverage reuses C's
                                            │    validated records + H's
                                            │    guard for snooze paths)
I (upgrade consent) ── independent; before D's rollout
D (archive pins) ── Bits PR first ─> reinstall on boxes ─> D merges
F (npm proof) ── after D (shares capability-readiness edits)
E (model hashing) ── after D/F (same readiness + installer files)
J (#986, no guessed :3737) ── stacked on A
K (multi-home stop/restart) ── after J (same lifecycle + server-lock files)
```

---

## PR A — #855 non-raster images never reach a vision model
Branch `fix/enrichment-raster-seam`

| # | Commit | Content | Verify |
|---|---|---|---|
| A1 | `refactor(media): one vision-raster set` | Export `VISION_RASTER_MIMES` (+ helper) from `packages/core/src/media/image-format.ts`; replace the copies in `plugins/chat/lib/routes.ts`, `plugins/chat/lib/channel-inbound.ts`, `src/core/conversation-turns.ts` (behavior identical) | chat attachment + conversation-turns tests unchanged and green |
| A2 | `feat(media): prepareImageAttachment rasterizes non-raster images` | `ImageNotSendableError { reason: 'sharp_unavailable' \| 'unrasterizable' \| 'too_large' }`; SVG/TIFF/HEIF → PNG (bounded density, `limitInputPixels`, first frame/page); `PreparedAttachment.owned`; cleanup on every throw; chat cleanup AND the enrichment runtime engine's audio passthrough object (`runtime.ts:138`) gain `owned` in this same commit so it compiles; filesystem errors rethrow untyped | new cases in `tests/core/media-downscale.test.ts` + `downscale-remediation.test.ts`: SVG→PNG, BMP→unrasterizable, malformed SVG, no-sharp, temp dir gone on each throw path |
| A3 | `fix(assets): enrichment preps once in the queue` | Queue calls the seam before the billed call (both engines): typed errors → failed/skipped; UNTYPED prep errors (EACCES/ENOSPC) → `failed` with counter before any provider retry; `AssetGoneError` accounting preserved; cleanup after success AND after the last retry; runtime engine drops its own prep; scanned-PDF prepares all pages before the first send; local `IMAGE_MIMES` deleted — classification uses the shared extension map + `image/*` fallback, eligibility from the shared set | `enrichment-queue`, `enrichment-runtime-engine`, `enrichment-direct-metering`: SVG succeeds through BOTH engines from a PNG; zero provider calls for BMP / no-sharp / malformed / page-2 prep failure; untyped prep error → failed + counted; temp dir gone after success and after exhausted retries; direct engine downscales >2 MB |
| A4 | `fix(assets): skips are version-scoped` | `markEnrichmentSkipped` records `forVersion`; `tallyEnrichment` treats older-version skips as stale | `enrichment-apply` + health-checks tests: same-version skip not retried by self-heal; newer version retried; force runs it |
| A5 | `docs(assets): raster seam + skip semantics` | `media-pipeline.md`, `assets-versioning.md`, `chat-plugin.md`, `conversation-kit.md` | — |

Live check: on 3737 after merge-candidate test, force-enrich one of the two
`20260723-bakin-logosvg-*` assets → caption present, no SVG sent.

## PR B — #758 team create/edit dialog
Branch `feat/team-form-dialog` · UI: load `bakin-ui-conformance` first

| # | Commit | Content | Verify |
|---|---|---|---|
| B1 | `fix(team): validate team updates` | zod body for `PUT teams/:id` (label trimmed non-empty, reportsTo string\|null) in `plugins/team/lib/routes/teams.ts` | `tests/plugins/team/routes.test.ts`: 400s for empty/whitespace/non-string; null reportsTo still normalizes |
| B2 | `feat(team): TeamFormDialog for create and edit` | new `plugins/team/components/team-form-dialog.tsx` (Dialog family, Field family, AgentSelect, guard wiring per D-B2, null=main per D-B3, baseline per D-B5); `team-manager.tsx` becomes a list with Add + per-row Edit; inline picker removed; the edit dialog reads the RAW team config (the roster route maps a missing reports-to agent to `null`, `plugins/team/lib/routes/agents.ts:123`, hiding "missing"); mutation helpers return an observable reload result so a failed reload after a successful save shows the drawer alert (`use-agent-store.ts:134` swallows it today); `ui-conformance.test.ts:100` updated in THIS commit | new `tests/plugins/team/team-manager.test.tsx` (RTL, act-clean): create; rename a main-reporting team without touching reports-to; edit reports-to; missing reports-to agent must be re-picked; dirty close → save/discard/stay; clean close; focus return (Stay → inside form, exit → trigger); busy; save error in dialog; edits survive a roster refresh; save ok + reload fail → drawer alert; router navigation guarded |
| B3 | `test(team): browser fixture` | team browser fixture for nested focus/dismissal | `bun run --cwd plugins/team test:ui`; `ui:conformance --quick` |
| B4 | `docs(team): editing teams` | team knowledge doc + user docs that describe creating teams | — |

Gate adds `ui:conformance --full`. Live check on 3737: create, rename,
change reports-to, dirty Esc.

## PR C — #898 narrow: acks, repair requests, skill content, brief
Branch `fix/health-trust-verification`

| # | Commit | Content | Verify |
|---|---|---|---|
| C1 | `fix(health): acks validate on read with the write rules` | shared validator (D-C1); bad records dropped from suppression + surfaced as an evidence gap in `doctor-report-cache.ts` | `tests/core/health-acks.test.ts` + report-cache tests: each forged shape fails to suppress; other acks survive |
| C2 | `fix(doctor): repair requests are schema-validated` | zod schema per file, malformed skipped + logged; future/invalid `createdAt` covers nothing; legacy defaults kept (until #945) | escalation + repair-store tests with fake clock |
| C3 | `fix(plugins): skill scan compares installed content` | one predicate for scan + installer skip, comparing `buildRuntimeSkill` output with `runtime.skills.get`; `.userEdited` skills are STILL compared and reported (locked-and-drifted is a warning, never ok) while overwrite stays blocked | plugin-assets tests: correct marker + wrong content → drifted → rewritten; locked + drifted → warning, not rewritten, overall not green |
| C4 | `fix(doctor): repair brief forbids silencing` | rules in `doctor-delegate.ts`; stale `.onboarded` comment fixed | delegate brief test pins the text |
| C5 | `docs(health): verification over trust` | `doctor-and-health-checks.md`, `approvals.md`, `plugin-system.md` | — |

## PR H — approvals provenance + agent-context refusal
Branch `fix/approval-provenance`

| # | Commit | Content | Verify |
|---|---|---|---|
| H1 | `refactor(approvals): provenance shape` | D-H1 types across the WHOLE boundary in one commit: `ApprovalActor` (`packages/core/src/plugin-types.ts:43`), `ApprovalResponse` (`packages/core/src/adapters/runtime/channels.ts:106`), approval records/service, and immediate consumers — workflow handlers, doctor audit formatting, channel adapters (Discord keeps its user id), cancellation records | approvals store/service + channel + workflow handler tests |
| H2 | `feat(cli): actor carries detected agent context` | `src/cli/actor.ts` detects run-dir context BEFORE honoring `--as`; carries both | `tests/cli/*actor*` |
| H3 | `fix(approvals): one guard before resolution side effects` | guard used by core resolve route, workflow gate routes/hooks + HTML form, Health apply/confirm; MCP/exec context → refused; in the SAME commit every legitimate client sends its declaration: task drawer approvals (`plugins/tasks/components/use-task-detail.ts:570`), doctor CLI (`src/cli/commands/doctor.ts:382`), workflow decision page/forms, Health UI | route tests per entry point: agent context + `--as human` refused with no side effect; missing declaration fails; each UI/CLI client's decision succeeds |
| H4 | `feat(approvals): honest provenance display` | decision surfaces render declared provenance (UI conformance: existing badge/text patterns) | RTL tests; `ui:conformance --quick` |
| H5 | `docs(approvals): provenance and its limits` | `approvals.md` (documented no-auth limit), `delivery-bridge.md` | — |

## PR G — bounded repair coverage, task reuse
Branch `fix/repair-coverage-bounded` (after C, H)

| # | Commit | Content | Verify |
|---|---|---|---|
| G1 | `fix(doctor): bounded coverage resurfaces the existing task` | ONE commit (expiry without reuse would spawn duplicates via `doctor-escalation.ts:94` / `doctor-delegate.ts:118`): review/blocked coverage bounded by the stale window, column moves don't reset it; on expiry or closed-but-unfixed the same task resurfaces with one notification per window | fake-clock tests: expiry, restart, repeated column moves, concurrent cycles, closed-but-unfixed, recurrence after verified; stable task id; no duplicate task |
| G2 | `feat(health): incidents link their repair task` | report projection carries the repair task id; the incident card links it through the existing resource-link pattern (`packages/sdk/src/types/health.ts:395` has no association today) | projection test (same task across restart); RTL test for the link; `ui:conformance --quick` |
| G3 | `docs(health): coverage window` | `approvals.md` / doctor doc | — |

## PR I — upgrade consent never trusts the lock
Branch `fix/upgrade-consent-declared`

| # | Commit | Content | Verify |
|---|---|---|---|
| I1 | `fix(plugins): consent required whenever bins or permissions are declared` | ATOMIC (a split would let the CLI default missing fields to empty and auto-accept — `src/cli/commands/plugins.ts:396`, `src/core/cli/consent-prompt.ts:118`): predicate from the target manifest, widening helpers deleted, new response shape, and every producer/consumer (upgrade implementations using `gate.widened`/`gate.newBins`, CLI prompt, UI) in one commit | upgrade-gate tests: forged lock still prompts; unchanged still prompts; empty → none; CLI prompt test: declared bins are never auto-accepted; `ui:conformance --quick` if UI touched |
| I2 | `docs(plugins): consent policy` | `plugin-lifecycle.md`, `plugin-system.md`, user docs | — |

## PR D — archive binaries verify against a manifest pin (+ Bits)

1. **Bits PR first** (`bakin-bits-official`, branch `feat/bin-extracted-pins`):
   add `extractedSha256` to terminal / ocr / transcribe, computed from
   freshly downloaded, archive-verified members; bump each version; Bits
   CI green; owner merges.
2. Per-box deployment gate: on EVERY box (this one now; margo on release
   day, by the owner) reinstall the three under the CURRENT Bakin and
   confirm the installed manifests carry the field BEFORE that box runs a
   Bakin build containing D. The PR body and the release checklist carry it.
3. Bakin branch `fix/bin-manifest-pins`:

| # | Commit | Content | Verify |
|---|---|---|---|
| D1 | `feat(plugins): archive bins require extractedSha256` | schema in `bin-requirement.ts`; fixtures updated | manifest validation tests |
| D2 | `fix(plugins): one bin verifier against manifest pins` | `verifyInstalledBin` hashes real bytes; installer verifies archive + member before `verifyArgs`/commit | bin-installer + bin-verify tests: forged binary + forged marker fails; wrong extracted pin runs `verifyArgs` ZERO times |
| D3 | `fix(packages): every bin caller uses the verifier` | plugin-assets, sync-scanner (duplicate rule deleted), capability-readiness bin leg; invalid manifest = visible finding | scanner, readiness, plugin-assets tests: forged binary + forged marker rejected by all four callers; an old manifest without the pin shows invalid, never green |
| D4 | `docs(plugins): bin pins` | `plugin-lifecycle.md`, `capability-packs.md`, `.claude/specs/plugin-managed-binaries.md`, Bits author docs | — |

## PR F — npm payloads prove their dependencies resolve
Branch `fix/npm-payload-verify`

| # | Commit | Content | Verify |
|---|---|---|---|
| F1 | `feat(packages): verifyNpmPayload` | new `src/core/agent-packages/npm-verify.ts` | unit tests: empty modules, wrong version/name, missing entry, ancestor fallback, altered script, scoped/ESM/exports-map |
| F2 | `fix(packages): installer reuse and readiness use it` | `requirements-installer.ts` reuse + staging check; readiness npm leg | installer + readiness tests; offline reuse of a valid payload |
| F3 | `docs(packages): npm readiness wording` | `capability-packs.md` | — |

## PR E — model files are hashed before any skip
Branch `fix/model-hash-before-skip` · `Closes #898`

| # | Commit | Content | Verify |
|---|---|---|---|
| E1 | `feat(core): streaming file integrity helper` | `packages/core/src/integrity/files.ts` | unit tests |
| E2 | `fix(packages): capability models hash before reuse` | `requirements-installer.ts`; readiness wording | same-size corruption defeats skip |
| E3 | `fix(search): antfly models hash before skip; mismatch fails` | `packages/adapter-antfly/src/models.ts`, `packages/adapter-antfly/src/model-pins.ts` (tokenizer pins, metadata cache no longer proof) | antfly model tests: same-size same-mtime corruption after a warmed cache defeats the skip; post-pull mismatch returns failure; tokenizer pin enforced; doctor wording structural-only; adapter-boundary arch test green |
| E4 | `docs(search): model integrity policy` | `search-system.md`, `capability-packs.md` | — |

## PR J — nothing reaches a guessed :3737 server (#986, added 2026-10-17)
Branch `fix/no-guessed-server`, stacked on A. Found while building A: the suite
defaulted `BAKIN_URL` to `localhost:3737` and several paths guessed `:3737`,
so tests reached the developer's live server and wedged a worker. Scope is
HTTP targeting ONLY: in-process dispatch kicks, the ONE target rule in
`src/core/server-lock.ts`, lock-only lifecycle verification polls, the
validate scripts, the suite's dead target (port 0). Process control
(`stop`/`restart` signaling) stays as on main — see K.

## PR K — multi-home `stop` / `restart` (added 2026-10-17)
Branch `fix/lifecycle-home-scope`, after J. Codex rounds 2–4 on J showed
the existing process control is home-blind: `stop`/`restart` SIGTERM every
`pgrep`-matched Bakin server machine-wide; restart drives the shared
LaunchAgent/systemd unit without checking which home it runs; a 2 s wait
races the lock handoff. A command-line identity check is NOT enough (misses
the compiled `bakin start`, `scripts/dev.ts`, the restart child; accepts
look-alikes). Design to settle in its own spec pass (Codex first, owner
confirms):
- **Identity by handshake:** the server reports `{ pid, bootId }` on its own
  port; signal a lock pid only when that answer matches the lock's
  `bootId`. Decide the wedged-server path (no answer) explicitly.
- **Service ownership from the LOADED service** (`launchctl print` /
  `systemctl show -p Environment,MainPID`), not the file on disk; setup
  records `BAKIN_HOME` always.
- **Handoff:** wait for the old pid to exit, then verify a NEW bootId.
- Unnamed servers are reported in BOTH output modes, never signaled.
- Tests fake discovery and forward signals only to owned children.
Codex findings to cover, in the order they were raised: J r2 #2, r3 #1–#4, r4 #1–#6.

---

## Checkpoints

- **After A + B:** both merged, 3737 restarted, SVG logos enriched, team
  dialog used live.
- **After C + H + G:** health-trust trio merged; a forged ack, a future
  request and an agent-context approval all behave per spec on 3737.
- **After I + D:** consent + bins merged with the Bits rollout complete on
  this box; margo's reinstall is a release-day gate (owner, never on-box by
  Claude).
- **After F + E:** #898 closes; memory updated; release still deferred.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| sharp unavailable in compiled binaries at rasterize time | A degrades to `failed` | typed `sharp_unavailable` + existing media-store install path; compiled-store teeth test stays green |
| H's guard blocks a legitimate operator path (e.g. Health apply from UI) | High | route tests for every UI/CLI path before the guard ships; live click-through on 3737 |
| D rollout order skipped (Bakin before Bits reinstall) | Bins show invalid | D merges only after the reinstall is confirmed; PR body carries the checklist |
| margo holds pre-#942 repair requests | C misreads them | legacy defaults kept until #945 |
| E hashing cost on large models during repair | Slow repair | streaming hash; only on skip/repair paths, never routine doctor |

## Open questions

None — all decisions confirmed in the interview.
