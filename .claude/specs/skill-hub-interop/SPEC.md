# Skill Hub Interop — Cross-Runtime Skill Installation (#687)

**Status:** BUILT (T0–T14 complete, 2026-07-28) — E2E validation (T15) pending
**Issue:** [#687 — Explore Bakin as a compatibility/runtime adapter for OpenClaw/ClawHub skills](https://github.com/markhayden/bakin/issues/687)

## 1. Objective

A path to install external skills/scripts and have them work on whichever runtime is
active — Pi or OpenClaw — starting from known sources (ClawHub, GitHub skill repos) with
a design that **branches** to unknown future hubs/formats without core releases.

**The operating principle (owner steer):** minimize Bakin management work at the core
level; rely on agents for conversion and mapping. Core owns only what agents cannot:
fetch, hash, pin, zip-safety, the trust gate, the lockfile, projection. Judgment calls
(reading foreign requirement dialects, future formats) belong to a **dispatched agent**
behind a human approval gate with mechanically verified output. Officially supported
skills are ported into `bakin-bits-official` as native capability packs — not special-
cased in core.

**The interface principle:** paste a link. Browse clawhub.ai (or GitHub) in a browser,
copy the page URL, paste it into the CLI or the Explore box. No hub browsing/search UI
inside Bakin; no deep hub integration.

**Out of scope:** executable code plugins / runtime extensions (runtime-private APIs;
Pi extensions have their own trust lane, #677); per-agent targeting (global-only v1);
auto-updates; npm sources; a dedicated update verb (re-running install re-pins);
binary-file bundles (empirically absent from the hub's top skills — refused honestly).

### Research grounding (2026-07-27)

- All three runtimes (OpenClaw, Pi, Hermes) natively read Anthropic's **Agent Skills
  standard** (`SKILL.md` + support files). Portability of skill *content* is already
  solved upstream — projection through the existing `runtime.skills` surface is the
  whole compatibility layer. We never rewrite `SKILL.md`.
- Runtime-specific extras live in sanctioned metadata namespaces (`metadata.openclaw.*`,
  `metadata.hermes.*`) that other runtimes ignore.
- **ClawHub** facts (verified live against clawhub.ai, 2026-07-27): skill page URLs are
  `https://clawhub.ai/{owner}/skills/{slug}`; `GET /api/v1/download?slug=&owner=[&version=]`
  serves the ZIP; bare ambiguous slugs return **409** and `GET /api/v1/skills/{slug}`
  returns a JSON `matches[]` list with `ownerHandle`/`ref`/`url`; moderation/scan
  endpoints exist per skill. Malware history is real (ClawHavoc: 824+ malicious skills,
  fake "prerequisite install steps" as the main vector; proven ranking manipulation).
- **Binary scan (live, top 30 by downloads):** 0/30 contain binary files; ~⅓ ship text
  scripts (sh/py/js). Binary-needing skills reference system tools in prose instead —
  which maps to the probe-only `prereqs` leg.
- Hermes hosts no hub; it aggregates ClawHub + GitHub + spec directories client-side —
  independent validation of this design. Pi's curated skills (`badlogic/pi-skills`) and
  `anthropics/skills` are plain GitHub repos of skill dirs.

## 2. Decision Record

v1 interview decisions D1–D15 revised by the dual review + owner steers:

| # | Decision |
|---|----------|
| D1 | Skills incl. text scripts + requirements; **no code plugins**; binary-file bundles refused honestly at preview (evidence: 0/30 top skills) |
| D2 | Sources: ClawHub + GitHub + local. **Paste-a-link is the interface** — clawhub.ai / github.com URLs normalize to refs; `clawhub:@owner/slug[@version]` / `github:owner/repo[@ref]#subpath` are aliases |
| D3 | Hub installs synthesize a `skill-pack` manifest and flow through the EXISTING agent-packages engine — zero parallel machinery |
| D4 | CLI: `bakin skills {install, list, remove, map}`. No `update` verb — re-running `install <ref>` re-runs the gate and re-pins |
| D5 | Trust gate: consent preview + hub verdict; suspicious/quarantined/revoked refused, **no --force**; versions always pinned; **fail closed** when ClawHub moderation fields are missing/unrecognized (soft "unverified" label ONLY for endpoint unreachability); deterministic **instruction-risk scan** (curl-pipe-bash / base64-exec patterns) as a loud preview warning, mandatory for verdict-less sources (github/local) |
| D6 | Global-only projection in v1 |
| D7 | UI: Explore paste box (URL-normalized) + an installed hub-skills list with readiness + remove. No hub search/browse UI |
| D8 | Provenance install-level only: lockfile + `.installedBy` + `upstream` stanza + audit events |
| D9 | ClawHub integration is **minimal**: only consumed endpoints (disambiguate, download, moderation/verdict), zod `.passthrough()` pinning only consumed fields, hardcoded base URL (settings override for tests), no `.well-known` plumbing |
| D10 | One skill per install; ref must resolve to a dir containing `SKILL.md` |
| D11 | Done bar: live E2E on BOTH runtimes via the dev rig — including a script-executing skill, the no-restart key journey, and switch-carry of nested-file skills |
| D12 | Deterministic translation is **frozen**, not extensible: exactly `metadata.openclaw.requires.{env,bins,anyBins}` + `metadata.openclaw.os` (+ `envVars`/`primaryEnv`) → secrets/prereqs/platforms. **This table is never extended** — any other dialect/namespace/prose routes to the agent mapping lane (D16), never to core code. Upstream install steps never executed. Everything unrecognized surfaces LOUDLY in the preview as unmapped text plus a claim-free env-var-shaped-strings mention line |
| D13 | adapter-pi: lift flat-only skill files (nested, traversal-guarded). Both adapters set the **executable bit** on projected scripts (shebang or script extension) |
| D14 | `manifest.runtimes`/`platforms` enforced server-side at install |
| D15 | Hermes: consumer-someday; design stays adapter-neutral |
| D16 | **Agent mapping lane** (`bakin skills map <name>`, this initiative, final phase): post-install + post-consent ONLY, a dispatched system turn (new `skill-mapping` work class, cheap-routed, metered) reads the installed bundle and proposes a requirements mapping. Output is schema-validated AND mechanically verified: every proposed env var/binary must literally occur in the bundle (grep); `secretSlot` is **schema-forced to the `skills.<NAME>` namespace** — the agent never chooses a slot (closes the map-onto-real-key exfiltration channel). Result shown as a diff; user approves; manifest amended; readiness lights up. Mapping prompt is upgradable content (bits `skill-porter` skill; core ships the default) |
| D17 | Official lane = bits: blessed skills get ported offline into `bakin-bits-official` as full capability packs (pinned bins, real secretSlots) and listed in the curated catalog. The paste-ref path is for the long tail |
| D18 | Guided-key restart trap fixed in this initiative: secret save performs **live env injection** (unset-only, env-first precedence preserved) so install → key → agent-turn works without a server restart; OpenClaw-daemon env propagation verified in E2E |
| D19 | User-facing skill identity is the bare skill name (CLI verbs, UI); the `hub-` prefix exists only in lockfile keys/package ids |

**Security invariants (non-negotiable):** the fetch and the trust gate are never in
agent hands; no LLM reads bundle content pre-consent; the mapping agent's output is
never trusted without mechanical verification; core never executes anything from a
bundle at install time.

## 3. Architecture

```
pasted URL / ref
   │  normalize (clawhub.ai/{owner}/skills/{slug} · github.com/... · schemes)
   ▼
fetch (clawhub minimal client | git clone | local) ──▶ staging
   │  zip-safety, sha verify, size cap, binary-file refusal
   ▼
synthesize bakin-package.json  (frontmatter fast-path + FROZEN openclaw table
   │                            + upstream stanza + loud unmapped surfacing)
   ▼
trust gate  (preview + verdict + instruction-risk scan + consent token)
   ▼
existing installer.ts (11-step) ─▶ runtime.skills projection ─▶ lockfile ─▶ audit
   ▼
readiness legs (secrets/prereqs/platforms) · doctor · runtime hub
   ▼ (optional, user-invoked, for unmapped requirements)
bakin skills map ─▶ agent proposes mapping ─▶ mechanical verification ─▶ approval diff
```

### 3.1 Ref normalization (`ref-normalize.ts`)

One pure module maps every accepted input to a canonical internal ref:
- `https://clawhub.ai/{owner}/skills/{slug}` → `clawhub:@{owner}/{slug}`
- `clawhub:@owner/slug[@version]`, bare `clawhub:slug` (server disambiguates via the
  409/matches flow — CLI/UI present the owner choice)
- `https://github.com/{owner}/{repo}/tree/{ref}/{path}` → `github:{owner}/{repo}@{ref}#{path}`
- `github:owner/repo[@ref][#subpath]`, local paths

### 3.2 ClawHub client (`clawhub-client.ts`)

Raw fetch, three calls only: skill lookup/disambiguation (`GET /api/v1/skills/{slug}`
incl. the ambiguous `matches[]` shape), download (`GET /api/v1/download?slug=&owner=&version=`,
verify `X-ClawHub-Artifact-Sha256` when present against received bytes), moderation/
verdict. Zod `.passthrough()` on consumed fields. Base URL constant + test override.
Missing/unrecognized moderation semantics → **refuse** (fail closed). Endpoint
unreachable → honest `unverified` label in the preview, user decides.

### 3.3 Synthesis (`skill-synthesis.ts`)

Pure function over (staged dir, source info). Frontmatter fast-path: `name` (validated),
`description`, `version` (frontmatter → hub-resolved → `0.0.0`). Package id `hub-<name>`
(lockfile key `hub-<name>@<ver>`; bare name everywhere user-facing, D19). `upstream:
{ source, ref?, resolvedSha? }` stanza (new optional field on the skill-pack manifest
schema). The FROZEN translation table (D12). Capability slug synthesized only when
requirement legs exist. Binary file detection → refusal with file list. Claim-free
mentions-scan (env-var-shaped strings in bundle text) feeds the preview and the
unmapped-requirements hint. `SKILL.md` projected verbatim, never rewritten.

### 3.4 Trust gate (`skill-trust.ts`)

Two-phase consent reusing `src/core/plugins/consent-token.ts` (token bound to
source+resolved sha; content drift between preview and install bounces to a fresh
preview). Preview: name/description/version/pin, source, file list + sizes, translated
requirement legs, raw unrecognized metadata verbatim, mentions line, instruction-risk
scan findings, and for ClawHub: moderation state, verdict, downloads/stars. Hard
refusals: non-approved moderation, suspicious verdict, hash mismatch, zip traversal/
symlink escape, size cap, binary files. Audit `skill.hub.refused` on refusal.

### 3.5 Projection

Existing `projectSkills()` / `runtime.skills.write` untouched in shape. adapter-pi
gains nested-path support (mirror adapter-openclaw's safe-path guard + per-file mkdir,
recursive reads). BOTH adapters chmod 755 files that have a shebang or a script
extension. Sync/switch-carry re-projects hub skills to the newly active runtime
unchanged; `.userEdited` semantics apply as-is.

### 3.6 Agent mapping lane (`skills map`)

For installed skills with unmapped requirements: a system send under work class
`skill-mapping` (declared at the call site per the model-routing matrix; cheap-routed;
metered like enrichment). Input: the installed (already consented) bundle files.
Output: structured proposal `{ secrets: [{name, help?}], prereqs: [{name, probe, help?}],
platforms?, notes }` — schema-validated, then verified: proposed names must literally
occur in bundle text; secretSlot minted by CORE as `skills.<NAME>`; anything unverifiable
is dropped with a visible note. CLI/UI show the resulting manifest diff; on approval the
synthesized manifest is amended, lockfile updated, readiness recomputed. Re-install of a
new version invalidates the mapping (re-verify literals; re-prompt if drifted). Default
porter prompt ships in core; a bits `skill-porter` skill can supersede it without a
Bakin release.

### 3.7 Surfaces

- **CLI** `src/cli/commands/skills.ts` (+ `skills` case in `cli/bakin.ts`):
  `install <url-or-ref> [--yes]` (normalize → preview → consent → install → readiness
  print + guided key via existing `printCapabilityStatus`/`promptMissingSecrets`),
  `list` (managed hub skills from lockfile + unmanaged `runtime.skills.list`, labeled),
  `remove <name>`, `map <name> [--yes]`. Ambiguous ClawHub slug → owner picker.
- **REST** `packages/host/src/api/skills/`: `POST preview`, `POST install` (token),
  `GET list`, `POST map/preview` + `POST map/apply`. Registered in the router +
  `HOST_STATIC_ROUTE_PATHS`. Remove rides the existing package-remove route.
- **Explore**: paste box (accepts URLs, normalizes; whole flow in the modal) + a "Hub
  skills" installed section (source/version/readiness chips, remove action, map hint
  when unmapped requirements exist). Explore plugin manifest version bump.
- **Secrets fix (D18)**: `POST /api/secrets` (or a post-store hook) performs the same
  unset-only env injection `secret-env.ts` does at boot. Shared benefit with existing
  capability packs.
- **Audit**: `skill.hub.installed/removed/refused/mapped` with `{ref, source, version,
  resolvedSha, verdict}`.

## 4. Code conventions & structure

Inherit repo conventions (TS strict, zod at boundaries, `createLogger('skills')`,
kebab-case, no empty catches, import order). New modules: `src/core/agent-packages/
{ref-normalize,clawhub-client,skill-synthesis,skill-trust,skill-mapping}.ts`;
changed: `source-fetcher.ts`, `installer.ts` (D14 preflight), `manifest.ts` (upstream),
`adapter-pi/src/skills.ts` + `adapter-openclaw` (exec bits), `secret-env.ts`/secrets
route (D18), `src/cli/commands/skills.ts`, `cli/bakin.ts`, `packages/host/src/api/skills/`,
`plugins/explore/`. Docs: new `.claude/knowledge/skill-hub-interop.md` + updates to
`agent-packages.md`, `capability-packs.md`, `explore-plugin.md`, `CLAUDE.md`, docs
site, `CHANGELOG.md`.

## 5. Testing strategy

Unit: ref normalization (every accepted URL/scheme form + garbage), synthesis
(frontmatter variants, frozen-table rules, binary refusal, mentions-scan), trust gate
(verdict matrix incl. fail-closed moderation drift + unreachable honesty, token
bind/drift, instruction-risk patterns incl. malicious fixture), clawhub client (mocked
HTTP: happy, ambiguous 409→matches, hash mismatch), pi nested files + exec bits + both
adapters, D14 preflight, mapping verification (literal-grep drops, forced slot
namespace). Integration: full install→lockfile→projection→readiness→remove on both
adapters (temp homes, mandatory mock rules), re-install-as-update re-pins + invalidates
mapping, REST preview/install/map with consent tokens, secrets live-injection.
Fixtures vendored (real ClawHub-shaped bundle w/ requirements + scripts, bare
pi-skills-style, malicious-shaped w/ traversal + curl-pipe-bash + fake install steps).
No live network in the suite. Live E2E per D11.

## 6. Boundaries

**Always:** pin, hash-verify when provided, record provenance, preview before any
write, treat all bundle content as untrusted, all installs through the one packages
engine, mapping only post-consent with mechanical verification.
**Ask first:** new source schemes; extending ANY part of the frozen table; UI beyond
D7; relaxing a hard refusal; per-agent scoping.
**Never:** auto-update; --force past a verdict; execute/shim code plugins; agent-side
fetch or trust decisions; pre-consent LLM reads of bundles; agent-chosen secret slots;
parallel lockfile/readiness machinery; backwards-compat shims.

## 7. Risks

- ClawHub API drift → minimal consumed surface, fail-closed, honest errors; GitHub
  remains a full path. Format drift / new hubs → the agent lane + bits, not core code.
- Prompt injection into the mapper → post-consent only + mechanical verification +
  forced slot namespace (residual: an attacker can only "claim" requirements that are
  literal strings in their own bundle, or hide one — visible runtime failure, not a
  security event).
- Run-time execution of malicious prose by agents (the real ClawHavoc vector) →
  verdict gate (clawhub) + instruction-risk preview scan (all sources) + consent. Not
  fully solvable at install time; documented honestly.
- Pi flat-only lift regressions → conformance tests + switch-carry round-trip tests
  (the guard's origin incident).

## 8. Process

Plan v2 in PLAN.md (with commit strategy) → build (`/agent-skills:build`) → test
(`/agent-skills:test`) → live E2E → docs sweep → Mark live-tests on the main checkout →
PR. Bits-lane work (porting blessed skills, `skill-porter` content) happens in
`bakin-bits-official` as follow-up, outside this repo.
