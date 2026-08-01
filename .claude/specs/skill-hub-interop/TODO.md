# Skill Hub Interop — Task Checklist v2 (#687)

Branch: `feat/skill-hub-interop-687` · Spec: SPEC.md v2 · Plan: PLAN.md v2

## Phase 0 — Ground truth
- [x] T0 fixtures + API-NOTES.md (verdict/versions shapes still to pin; download/409/URL shapes already verified live)

## Phase A — Standalone fixes (CP-A)
- [x] T1 adapter-pi nested skill files + exec bits both adapters (+ switch-carry tests)
- [x] T2 `upstream` stanza on skill-pack manifest schema
- [x] T3 server-side runtimes/platforms enforcement (D14)
- [x] T4 secrets live env injection on save (D18)

## Phase B — Engine (CP-B)
- [x] T5 ref-normalize.ts (paste-a-link → canonical refs)
- [x] T6 skill-synthesis.ts (frontmatter fast-path + FROZEN table + binary refusal + mentions-scan)
- [x] T7 raw-bundle installs from github/local (re-install = update)
- [x] T8 minimal clawhub client + `clawhub:` scheme (3 endpoints, fail-closed)

## Phase C — Surfaces (CP-C)
- [x] T9 trust gate (preview, verdicts, instruction-risk scan, consent tokens)
- [x] T10 REST /api/skills/{preview,install,list,map/*} (+ HOST_STATIC_ROUTE_PATHS)
- [x] T11 `bakin skills {install,list,remove,map}` CLI group (bare names) — `src/cli/commands/skills.ts`, dispatched from `cli/bakin.ts`

## Phase D — UI + agent lane (CP-D)
- [x] T12 Explore paste box + installed hub-skills list (modal flow, version bump)
- [x] T13 agent mapping lane (`skills map`: work class, mechanical verification, approval diff)

## Phase E — Ship (CP-E)
- [x] T14 docs sweep (knowledge docs, CLAUDE.md, docs site, CHANGELOG, README check)
- [x] T15 done bar (automated legs): suite 8498 pass/0 fail + lint + cycles green; live E2E against real ClawHub + GitHub on an isolated server — the gate refused a real DO_NOT_INSTALL skill (the #1 most-downloaded!), paste-URL install/exec-bits/list/remove/ambiguity-picker/D18-live-injection all verified on Pi
- [x] T15 live-LLM legs (Mark's 3737 pass)
- [x] Mark live-tests on main checkout → PR → merge — **PR #750 merged 2026-07-30** (`53af28cc1`), Main CI green

## Outside this repo (follow-up, bakin-bits-official) — DONE
Both landed in **bakin-bits-official PR #94**, merged 2026-07-30 (`00e0afe5f`).
- [x] Blessed skills as native capability packs + catalog entries (D17) — `github`, `google-workspace`, `notion`, `office-docs`
- [x] `skill-porter` skill (supersedes the core default mapping prompt)
- [x] `packs/pack-contract.test.ts` — packs had no contract coverage at all (unplanned; added because these five packs doubled the count)

**What the survey changed.** D17 assumed blessed hub skills were worth porting.
A survey of ClawHub's top 40 by downloads found the opposite: the most-installed
skills ship no install legs — steipete's `github`, `gog`, `notion`, `obsidian`,
`nano-pdf`, `weather`, `sonoscli`, `mcporter` are each two files of prose
assuming a CLI already exists, and almost none carry a license. Copying them
adds nothing the paste-a-link path does not already handle. So the packs are
Bakin-**authored** and supply the leg those skills lack. D17's "official lane =
bits" intent holds; "port" was the wrong verb.

**Binary policy (Mark, 2026-07-30):** packs declare PATH prerequisites with a
help link rather than mirroring third-party binaries into bits releases —
re-cutting on every upstream release is a maintenance treadmill, and a missing
prereq already reports honestly. An xterm.js terminal in the Bakin UI was
floated as a possible future answer to guided manual installs.

**Bug the live test caught:** `notion` first shipped `secretSlot: "notion.token"`,
which the injection layer refuses (packs may only bind their own `skills.*`
namespace — the #687 review fix working against our own pack). Readiness said so
verbatim instead of reporting a false green. Minted `skills.<pack>.<ENV_VAR>`
slots are now enforced by the pack contract test.

## Post-live-test feedback (Mark, 2026-07-28)
- [x] Unify the UI: ecosystem lane moved INSIDE the Capabilities tab (paste-a-link CTA + drawer preview + "From the ecosystem" installed list above the curated grid); Hub Skills tab removed — no per-source tab sprawl

## Code-review fixes (3 siloed reviewers, 2026-07-28) — PR #750
P0 (security + broken flows):
- [x] #1 Disclose downloadable legs (bins/npm/models) in preview + bind to consent (Mark: disclose, not refuse)
- [x] #2 Strip .git/node_modules from staging before synthesis (headline paste-a-repo flow broken)
- [x] #3 Gate pack secretSlot to skills.* namespace (cross-slot credential exfil) + per-package slot namespace
- [x] #4 Install the VERIFIED staging (consent TOCTOU: bytes reviewed ≠ installed)
- [x] #5 Real verdict state through FetchedSource — unscanned/pending/empty never "clean ✓"
- [x] #6 confirmSkillInstall supersedes existing hub-<id> (update path broken)
P1 (correctness):
- [x] CLI error branches dead (apiPost throws) — use apiPostJson, fix exit codes + test mock
- [x] Typed SkillRefusalError (isRefusal message-text classification)
- [x] D14 gate in updater; findInstalledSkill guarded parse + ambiguity
- [x] name fallback from repo/slug not ref segment; whole-tree preview scan (multi-skill + traversal)
- [x] "official" chip overclaims; 5xx logging; mapPreview 5xx status
Nits (all done): split('.',2) truncation, byte-cap units, size caps for github, openclaw mid-loop+name, computeDirSha symlinks, previewBusy guard, aria-label, brace-walk strings, drift-under-yes, empty-state title, USAGE --yes

## CI investigation (2026-07-29/30) — evidence, for whoever picks this up
Bisected with two throwaway PRs (both closed, branches deleted):
- Control PR from an UNMODIFIED main tree, same window → **fully green**. CI itself is healthy.
- Bisect PR: all #687 source changes, 14 new test files parked as `.disabled` → **fully green**.
- Same branch + the 6 heavy fs/install test files re-enabled → **failed**.

Each failing run trips a DIFFERENT pre-existing timing-sensitive test, never one of ours:
- `OverviewTab > a failed repair surfaces the reason` (timed out at 37s, limit 15s)
- `createRuntimeToolUsageRecorder > records result-only Bakin observations…` (asserts an exact global usage count)
- `PluginHost > bounds a hung hot-swap import…` (a timeout-bounding test)
Some runs instead STALL outright (~6800/8520 tests, ~190 files never start, zero failures logged).

Not reproducible locally: 5 full macOS runs green (stamped and unstamped), a 4-CPU/7GB Linux
container run green, and victims+our files run together 3× green. Our files are cheap
(83–340 ms each, ~1.6 s total), so this is scheduling perturbation tipping latent flakes on
GitHub's runners, not added load.

One REAL hang of ours was found and fixed: hub-skills-section.test.tsx fired async click
handlers whose state updates landed outside act(); under --isolate that pins a worker open
forever. Interactions now flush inside act().

Open question for maintainer: harden the three flaky victims (whack-a-mole risk), or accept
rerun-to-green per the repo's existing convention.

## Live-test findings (Mark, 2026-07-30)
Installed `clawhub:@buksan1950/reddit-readonly` on the live box — install, projection
(`~/.pi/agent/skills/reddit-readonly`), provenance marker, and the unified Installed list all
correct; the agent read SKILL.md and executed the script.
- Execution hit `HTTP 403` from Reddit. NOT ours: reproduced 3/3 from this machine with the
  skill's own UA, a browser UA, and no UA. Reddit blocks unauthenticated `.json` access. The
  agent formatted the skill's own `{ok:false}` error and fell back to `bx-search` — intended
  behavior. Skill honors `REDDIT_RO_USER_AGENT`, but no UA helps.
- REAL GAP FOUND + FIXED: the skill declares `requires.bins:["node"]` under the legacy
  `metadata.clawdbot` alias, so synthesis translated NOTHING (no prereq, no capability). Now
  reads `openclaw` → `clawdbot` → `clawdis` (documented aliases of the same namespace, from the
  project's renames). Fixture + pins added. Reinstall that skill to pick up the node prereq.
