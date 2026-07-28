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
- [ ] T11 `bakin skills {install,list,remove,map}` CLI group (bare names)

## Phase D — UI + agent lane (CP-D)
- [x] T12 Explore paste box + installed hub-skills list (modal flow, version bump)
- [x] T13 agent mapping lane (`skills map`: work class, mechanical verification, approval diff)

## Phase E — Ship (CP-E)
- [x] T14 docs sweep (knowledge docs, CLAUDE.md, docs site, CHANGELOG, README check)
- [x] T15 done bar (automated legs): suite 8498 pass/0 fail + lint + cycles green; live E2E against real ClawHub + GitHub on an isolated server — the gate refused a real DO_NOT_INSTALL skill (the #1 most-downloaded!), paste-URL install/exec-bits/list/remove/ambiguity-picker/D18-live-injection all verified on Pi
- [ ] T15 live-LLM legs (Mark's 3737 pass): an agent turn actually exercising an installed skill; a live `bakin skills map` run; OpenClaw-side projection sanity if the adapter gets switched
- [ ] Mark live-tests on main checkout → PR → merge

## Outside this repo (follow-up, bakin-bits-official)
- [ ] Port 2–3 blessed skills as native capability packs + catalog entries (D17)
- [ ] `skill-porter` skill (supersedes the core default mapping prompt)
