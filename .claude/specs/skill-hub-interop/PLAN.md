# Skill Hub Interop — Implementation Plan v2 (#687)

**Spec:** SPEC.md v2 (revised after dual independent review, 2026-07-27)
**Branch:** `feat/skill-hub-interop-687` — created in the MAIN checkout (house rule:
test-live-before-merge; Mark tests before merge).

## What changed from plan v1 (review disposition)

- Translation engine → **frozen** micro-table + loud unmapped surfacing (never extended).
- NEW: agent mapping lane (`skills map`) as the final build phase — the extensibility
  model is an agent + bits content, not core parsers.
- NEW: paste-a-link normalization (clawhub.ai / github.com URLs) as the primary input.
- NEW: exec bits on projected scripts; binary-file bundles refused (0/30 top skills
  have binaries — verified live).
- NEW: live secret-env injection on save (kills the guided-key restart trap, D18).
- NEW: deterministic instruction-risk scan in the trust gate; fail-closed moderation.
- ClawHub client shrunk to 3 consumed endpoints; no `.well-known` plumbing.
- CUT: `skills update` verb + per-source update probes (re-install re-pins);
  `check` REST route; hub-search UI (never planned, reaffirmed).
- Explore ships paste box **and** an installed-hub-skills list with remove.

## Dependency graph

```
T0 (fixtures + API notes — partially done during review)
T1 (pi nested + exec bits)  T2 (upstream stanza)  T3 (D14)  T4 (secrets live-inject)   ── independent
        └──────────┬──────────────┴──────────┬─────┘
                   ▼                         │
T5 (ref-normalize) ─▶ T6 (synthesis + frozen table) ─▶ T7 (raw bundles github/local)
                                                            │
                                             T8 (clawhub client + scheme)
                                                            │
T9 (trust gate) ──▶ T10 (REST) ──▶ T11 (CLI) ──▶ T12 (Explore box + installed list)
                                        │
                                 T13 (agent mapping lane)
                                        │
                          T14 (docs sweep) ── T15 (E2E + suite, done bar)
```

## Commit strategy (rollback checkpoints)

One conventional commit per task; every commit green (typecheck + affected tests +
lint). Later phases only ADD call sites — reverting a checkpoint removes its layer
cleanly.

| Checkpoint | After | Revert story |
|---|---|---|
| CP-A | T1–T4 | Standalone fixes (adapter correctness, schema field, enforcement, secrets UX). Worth keeping even if the initiative dies. |
| CP-B | T5–T8 | Engine installs raw bundles from all three sources, server-side only. No user surface references yet. |
| CP-C | T9–T11 | Trust gate + REST + CLI. First user-facing checkpoint. |
| CP-D | T12–T13 | Explore UI + agent mapping lane. |
| CP-E | T14–T15 | Docs + validated E2E. Merge gate: Mark live-tests, then PR. |

Commit messages:
- `test(fixtures): vendor skill-bundle fixtures + ClawHub API notes (#687)` (T0)
- `feat(adapter-pi): nested skill files + exec bits on projected scripts` (T1)
- `feat(packages): upstream provenance stanza on skill-pack manifests` (T2)
- `feat(packages): enforce manifest runtimes/platforms at install` (T3)
- `fix(secrets): live env injection on secret save` (T4)
- `feat(skills): ref normalization for hub URLs and schemes` (T5)
- `feat(skills): manifest synthesis with frozen requirement table` (T6)
- `feat(skills): install raw skill bundles from github/local sources` (T7)
- `feat(skills): minimal clawhub client + source scheme` (T8)
- `feat(skills): trust gate — preview, verdicts, risk scan, consent tokens` (T9)
- `feat(skills): REST preview/install/list/map routes` (T10)
- `feat(skills): bakin skills CLI command group` (T11)
- `feat(explore): paste-a-link install + installed hub-skills list` (T12)
- `feat(skills): agent mapping lane (skills map)` (T13)
- `docs(knowledge): skill hub interop deep reference + doc sweep` (T14)
- `test(skills): E2E hardening from live dual-runtime validation` (T15, if fixes fall out)

## Tasks

### T0 — Fixtures + API notes
Consolidate the live-API findings already gathered (download `?slug=&owner=&version=`,
ambiguous-slug 409 + `/skills/{slug}` matches shape, page-URL format, integrity header)
into `API-NOTES.md`; fetch one moderation/verdict response and one versions listing to
pin those shapes too. Vendor fixtures under `tests/fixtures/skill-bundles/`:
(1) clawhub-style with `metadata.openclaw` requirements + scripts, (2) bare
pi-skills-style, (3) malicious-shaped (zip traversal entry, curl-pipe-bash in a script,
fake "install prerequisite" steps in SKILL.md, an env-var mention only in prose),
(4) one with a binary file (refusal fixture). **Accept:** API-NOTES complete; fixtures
load in tests; no later test needs live network.

### T1 — adapter-pi nested skill files + exec bits (both adapters)
Lift the flat-only guard (`adapter-pi/src/skills.ts:117`) → safe-relative-path
validation (reject `..`, absolute, sidecars), per-file `mkdirSync(dirname())`,
recursive tree read keyed by relative path. In BOTH adapters' `write`: chmod 755 when
file has a shebang or script extension (.sh/.py/.js/.mjs/.rb/.pl). **Accept:** nested
round-trip, traversal rejected before first write, exec-bit set on scripts (stat mode
asserted), sidecars excluded at depth; switch-carry round-trip test with a nested-file
skill (the guard's origin incident); existing adapter + conformance suites green.

### T2 — `upstream` stanza
Optional `upstream: { source, ref?, resolvedSha? }` on the skill-pack manifest schema.
**Accept:** parse/round-trip tests; other kinds unchanged.

### T3 — Server-side runtimes/platforms enforcement (D14)
Preflight in `installer.ts` after manifest parse; refusal copy matches the Explore
badge; audit `pkg.install_refused`. **Accept:** refusal + pass-through tests; existing
install tests green.

### T4 — Secrets live injection (D18)
On secret save (`POST /api/secrets` path / store hook), run the same unset-only
injection `secret-env.ts` performs at boot (env-first precedence: never overwrite an
existing process env var). Investigate + document OpenClaw-daemon propagation (separate
process — likely needs its own restart note; be honest in the readiness copy if so).
**Accept:** unit test — save then `process.env` visible; existing precedence tests
green; readiness reflects reality without restart on Pi.

### T5 — Ref normalization
NEW `ref-normalize.ts` (pure): clawhub.ai page URLs, github.com tree/blob URLs,
`clawhub:`/`github:` schemes, local paths → canonical internal ref or a typed error
with a helpful message. **Accept:** table-driven tests over every accepted form +
garbage inputs; error copy actionable.

### T6 — Synthesis + frozen table
NEW `skill-synthesis.ts` (pure): frontmatter fast-path (name/description/version;
case-tolerant SKILL.md/skill.md), id `hub-<name>`, upstream stanza, the FROZEN
`metadata.openclaw.requires.{env,envVars,primaryEnv,bins,anyBins}` + `os` table →
`secrets[]` (slot `skills.<NAME>`) / `prereqs[]` (probe-only; anyBins→optional) /
`platforms`, capability slug only when legs exist, binary-file detection (utf-8 decode
test) → typed refusal, claim-free mentions-scan of env-var-shaped strings. A code
comment + test pin the never-extend rule (test fails if new namespace keys are added
to the table without touching the spec). **Accept:** table-driven tests: frontmatter
variants, every translation rule, binary refusal, mentions-scan, unmapped-loudness
output shape.

### T7 — Raw-bundle install path (github/local)
`source-fetcher.ts`: target without `bakin-package.json` but with a skill file →
synthesis writes the manifest into staging (top-level installs only; declared pack
deps still require real manifests). **Accept:** integration — local + mocked-clone
github raw bundles: lockfile `hub-<name>@<ver>` with upstream, global projection on
both adapters (temp homes), readiness legs when requirements exist, remove cleans;
re-install of same ref re-pins (this IS update — assert version/sha change path);
manifest-bearing sources bit-identical behavior.

### T8 — ClawHub client + scheme
NEW `clawhub-client.ts`: 3 calls (lookup/disambiguate incl. 409→matches, download w/
`X-ClawHub-Artifact-Sha256` verification when present, moderation/verdict), zod
`.passthrough()` on consumed fields, hardcoded base + test override. `clawhub:` in
`source-fetcher.ts`: resolve → download → safe-extract (traversal/symlink/size caps)
→ stage → synthesize; no-version refs pin the resolved version. **Accept:** mocked-HTTP
tests — happy path, ambiguous→matches surfaced, hash mismatch refusal, traversal
refusal, size cap; grep-style test: no clawhub identifiers outside the client/fetcher.

### T9 — Trust gate
NEW `skill-trust.ts`: preview assembly (per SPEC 3.4), verdict integration
(fail-closed on missing/unrecognized moderation semantics; `unverified` label only on
unreachability), deterministic instruction-risk scan (pattern list incl.
curl/wget-pipe-shell, base64-decode-exec; mandatory surfacing for verdict-less
sources), consent tokens via existing `consent-token.ts` bound to source+resolved sha
(drift → fresh preview). Audit `skill.hub.refused`. **Accept:** verdict matrix, risk
scan against malicious fixture, token bind/drift tests.

### T10 — REST routes
NEW `packages/host/src/api/skills/`: `POST preview`, `POST install`, `GET list`
(lockfile hub skills + unmanaged runtime skills, labeled), `POST map/preview`,
`POST map/apply` (T13 wires the engine; route shape lands here behind a
not-yet-available error until T13). Router + `HOST_STATIC_ROUTE_PATHS`. Audit
installed/removed events. **Accept:** route integration tests (temp homes, mocked
hub): preview/consent/install/drift-bounce/list; router arch tests green.

### T11 — CLI group
NEW `src/cli/commands/skills.ts` + `skills` case in `cli/bakin.ts` + help:
`install <url-or-ref> [--yes]` (normalize, preview render, owner picker on ambiguous,
consent round-trip, readiness print + `promptMissingSecrets`), `list`,
`remove <name>` (bare names, D19), `map <name> [--yes]` (T13 engine; friendly
"not built yet" until then if landed first). Help text notes re-install = update.
**Accept:** CLI tests per existing pattern; bare-name resolution against `hub-` keys.

### T12 — Explore: paste box + installed list
Paste input accepting URLs/refs (client calls preview → modal with trust signals/
files/requirements/risk warnings → consent → install → guided key step) + "Hub skills"
installed section (name, source, version, readiness chips, remove, "map available"
hint). Whole flow in the modal (house rule). Explore manifest version bump (patch).
**Accept:** component tests (rtl-settle rules): preview render, refusal render,
installed-list + remove call shape; no hard navigation; no new mutation endpoints
beyond `/api/skills/*`.

### T13 — Agent mapping lane
NEW `skill-mapping.ts`: `skill-mapping` work class declared at the call site
(system-route), default porter prompt in core (bits `skill-porter` can supersede —
document the lookup), structured proposal schema, mechanical verification
(literal-grep; core-minted `skills.<NAME>` slots; unverifiable → dropped with note),
manifest amend + lockfile update + readiness recompute; re-install invalidates
mapping. Wire `map/preview` + `map/apply` + CLI `map`. Post-consent only (operates on
installed bundles). **Accept:** verification unit tests (injection-shaped proposals
dropped: nonexistent env var, attempt to name a real provider slot), integration with
mocked runtime turn, abort/failure honest (`map` failing leaves manifest untouched).

### T14 — Docs sweep
NEW `.claude/knowledge/skill-hub-interop.md`; update `agent-packages.md` (synthesis,
`hub-` keys, upstream), `capability-packs.md` (translated-requirements variant + D18
live injection), `explore-plugin.md` (paste box + installed list); `CLAUDE.md` (Agent
Packages pointer + CLI line); docs site page; `CHANGELOG.md`; README check. Spec
status flip. **Accept:** docs match shipped behavior; no stale claims.

### T15 — Done bar (D11)
Full `bun run test` + `bun run lint` + `bun run check:cycles`. Dev rig BOTH runtimes:
install via CLI and via Explore paste box — one text-only ClawHub skill (pasted page
URL) + one script-executing skill + one key-requiring skill
(`github:badlogic/pi-skills` brave-search or equivalent); assert: projection +
runtime discovery, script exec bit honored in a real agent turn, guided key →
readiness green → successful turn **without server restart** (Pi; document OpenClaw
daemon reality honestly), `skills map` on a fixture-grade unmapped skill end-to-end,
remove cleans both runtimes, runtime switch re-projects hub skills (nested files
intact). No leftover dev instances (ports free). **Accept:** evidence in PR
description; follow-up issues filed for anything deferred.

## Verification cadence

Per task: typecheck + targeted tests + lint pre-commit. Per checkpoint: full suite.
Mandatory test-isolation rules apply (content-dir ×2 mocks, openclaw home, PI_HOME
env-before-import; `Bun.fetch` for real HTTP).

## Guard rails during build

No code-plugin execution, no per-agent installs, no auto-update, no update verb, no
npm/url sources, no hub-search UI, no --force past verdicts, no extending the frozen
table, no pre-consent LLM reads, no agent-chosen secret slots, no parallel machinery,
no compat shims.
