# Capability Packs

Skill-packs that name a capability and declare what it needs — the vehicle
for giving agents real-world powers (web search, browser automation,
transcription) on ANY runtime, with Bakin owning the entire install path on
a net-new machine: discover → consent → content → pinned binaries → guided
key → honest readiness. Born in the pi-parity initiative
(`.claude/specs/pi-parity/SPEC.md`, D3/D4); the P0 spike proved a single
SKILL.md delivers full web-search task parity, so Bakin builds **zero**
tool wrappers — it manages ecosystem content instead.

## Taxonomy (D15 — keep these lanes clean)

One rule: **who consumes it.**

| Primitive | Consumer | Ships | Example |
|---|---|---|---|
| Plugin | Bakin (server + browser) | Code: UI, routes, exec tools | chat, images |
| Capability pack (skill-pack) | Agents (runtime reads it) | Content: SKILL.md + `requires` | web-search-brave |
| Agent package (kind: agent) | Team roster | Identity + persona | nemo, pixel |

- **Coupling rule:** a skill that teaches agents a plugin's own exec tools
  ships WITH that plugin (images' create-image skills). A standalone skill
  wrapping external tools ships as a capability pack.
- **No in-process code in packs.** Pack scripts run as agent shell commands
  in agent workspaces. In-process code = a plugin, or (deferred lane) a Pi
  extension — see the reserved trust design in the spec §10.2.
- **Composition rule:** a capability needing UI/governance AND agent content
  ships as a plugin + a companion pack (future email = gmcli pack +
  governance plugin), never a hybrid artifact.

## Manifest (packages/core/src/agent-packages/manifest.ts)

A capability pack is `kind: "skill-pack"` plus:

- `capability` — slug (`web-search`) for catalog facets + readiness ids.
- `runtimes` — default `['*']` (skills are a cross-runtime convention,
  projected via `runtime.skills` wherever the ACTIVE runtime reads skills);
  adapter slugs when genuinely runtime-specific. Explore badges/gates
  install against the active adapter.
- `requires.bins[]` — `{ name, version, install: { <platform>: { url,
  sha256, archive?: { format: 'tar.gz', member } } }, verifyArgs? }`;
  platforms `darwin-arm64|darwin-x64|linux-x64|linux-arm64`; https-only
  (loopback http allowed for test fixtures). With `archive`, the sha256
  pins the TARBALL and `member` is extracted as the binary.
- `requires.npm[]` (pi-ecosystem WS2) — `{ name, source, dependencies
  (EXACT pins only), env? }`. Scripts from the pack-relative `source` dir +
  a generated `type:module` package.json + node_modules install into
  `~/.bakin/npm/<packId>/<name>/` (unversioned so SKILL.md paths survive
  upgrades) via the SYSTEM bun with `--ignore-scripts` (whiskit env
  allowlist; `env` overlays, e.g. PUPPETEER_SKIP_DOWNLOAD). HARD RULE:
  node_modules can NEVER live in a projected skill — Pi's skill writer
  rejects nested paths and both drift hashes walk every file. Zero-dep
  payloads (vendored scripts) never invoke bun. Unchanged deps +
  node_modules present = install skipped, so offline repair converges.
- `requires.models[]` — `{ name, url, sha256, bytes, dest, env? }` into
  `~/.bakin/models/<dest>`; streams to disk (never buffered), sha256+size
  verified, atomic rename; size+marker fast path avoids re-hashing ~GB
  files. `bytes` drives the CLI consent preview. `env` is injected at boot
  (`injectPackModelEnv`, secret-env pattern, unset-only) with `{dest}`
  expanding to the absolute installed path — how a consuming binary finds
  its model (transcribe: PARAKEET_CPP_MODEL_PATH).
- `requires.prereqs[]` — `{ name, kind: 'binary'|'app', probe, help,
  optional? }` — CHECKED, never installed (binary = PATH lookup, app =
  absolute path existsSync). Missing required prereqs block readiness with
  the help link as remediation; `optional: true` surfaces without blocking
  (transcribe's ffmpeg).
- `platforms?` (pack level) — OS/arch gate; a gated pack on the wrong
  platform reports "not available on this platform", never per-leg noise
  (transcribe is darwin-arm64 only).
- `secrets[]` (base field, now enforced) — `{ name: ENV_VAR, description,
  required, secretSlot: '<provider>.<name>', help: url }`. `secretSlot`
  drives the guided key step and boot env injection.

## Install pipeline (src/core/agent-packages/)

Standard agent-packages install (lockfile, `.installedBy` sidecars,
rollback, receipts) with two additions:

- **`requirements-installer.ts`** — `installManifestRequirements` is THE
  one entry point every projection pass calls (install parent+deps, update
  fail-fast BEFORE teardown, local re-projection best-effort with previous
  rows kept offline) for ALL legs: bins + npm payloads + models. Any pass
  that rewrites lockfile projections without this call silently untracks
  legs (PR #673 lesson). Dropped-leg sweeps on upgrade are refcount-aware
  for shareable targets (`withoutSharedArtifacts`: bins + models; npm
  payload dirs are per-pack, never shared).
- **`bin-installer.ts`** — antfly-installer pattern: download with timeout →
  sha256 verify against the pin (refuse on mismatch) → chmod 0755 →
  verify-then-commit (`verifyArgs` run against the temp file) → atomic
  rename into `getBakinPaths().bin` (`~/.bakin/bin`, prepended to PATH at
  server boot by `src/core/secret-env.ts`). Bins are `bin` lockfile
  projections: install-failure rollback and uninstall ride the standard
  lifecycle; the uninstaller keeps a bin any other installed package still
  projects (refcount-aware). Idempotent: an on-disk bin matching the pin
  skips the download — shared bins across packs come free. Bins survive
  EVERY projection pass (PR #673): version upgrades install the new
  manifest's bins FIRST (fail-fast — a bad download aborts before any
  teardown), dropped bins honor the shared-bin rule, and local repair
  (`repairPackLocally` / `bakin packages sync`, which always re-projects
  locally) restores deleted binaries best-effort — offline, skills still
  repair and previous bin rows stay lockfile-tracked.
- **Guided key step** — `POST /api/packages/install` resolves bare names
  from the curated catalog (`sourceWithRef` pin) and returns the pack's
  readiness; the CLI (`bakin packages install <name>`, consent + `--yes`)
  and Explore's install dialog both offer key entry into the masked secret
  store, skippable — "installed, needs key" is an honest standing state.

## Readiness — ONE engine

`src/core/agent-packages/capability-readiness.ts` (`listCapabilities()`):
content leg (lockfile skill projections resolved against live
`runtime.skills`), bins leg (Bakin bin dir; honest `unsupported-platform`),
npm leg (payload dir + node_modules when deps exist), models leg (dest
present at declared size), prereqs leg (PATH/app probes; optional ones
never block), platform gate (`platformSupported`), secrets leg (env →
store per `secretSlot`). Non-ready legs carry remediation strings. Surfaces (all thin clients): `GET
/api/packages/capabilities`, the health plugin's `capability.<slug>` doctor
findings, `bakin check capabilities` (the `capabilities` onboarding
component — check = readiness + missing recommendations; install =
defaultSelected packs under `--yes`; NEVER stalls on a key), and the
runtime hub's Capabilities tab.

## Secrets & env (P1 foundation)

`~/.bakin/secrets.json` holds NAMED secrets per provider
(`brave.apiKey`, later `discord.botToken`) — 0600, atomic, masked
`/api/secrets` (names only), Settings → Integrations & Keys UI. Env always
overrides the store. At server boot (`src/core/secret-env.ts`, after the
singleton lock, never in `createAppServices`) stored secrets fill UNSET
declared env vars and `~/.bakin/bin` joins PATH — Pi agent shells inherit
the server process env, so one injection serves every turn on every
runtime. Injected values are readable by agent shell commands — that is
the point; the keys are given to agents deliberately. Future 1Password
integration = `op://` references resolved at the single read chokepoint
(spec §13).

**D18 (#687):** injection is no longer boot-only. Boot collects
PACK-declared secretSlot mappings from installed manifests
(`collectPackSecretMappings` — previously only the static list injected),
and every secret save through `POST /api/secrets` live-injects the
declared env vars for that slot (`injectSecretEnvForSlot`, unset-only,
env wins) — the guided-key journey works without a server restart.
Secret DELETE deliberately does not scrub `process.env`.

**Translated-requirements variant (#687):** hub-installed skills
(`hub-<name>` packs synthesized from raw SKILL.md bundles) declare
secrets/prereqs via the frozen `metadata.openclaw` translation or the
`bakin skills map` agent lane — slots always minted in the `skills.*`
namespace, bins always probe-only prereqs (never pinned downloads).
They ride this same readiness engine when requirement-bearing (a
capability slug is synthesized only then). See
`.claude/knowledge/skill-hub-interop.md`.

## Curation (bakin-bits-official)

Packs live at `packs/<id>/` with the catalog entry in both the bits
`catalog.json` and the embedded `packages/host/src/data/curated-catalog.json`
(`capability` + `runtimes` facets). Pin real upstream content deliberately —
the first pack (`web-search-brave`) ships the spike-validated bx skill with
sha256-pinned brave-search-cli binaries. Keep packs à-la-carte: one
capability per pack. `bakin packages upgrade` re-pins deliberately;
upstream drift never lands silently.

The `ocr` pack (#742 Phase 2) pins `ocrit` (Apple Vision OCR, BSD-2-Clause)
via a **binary-mirror release** in the bits repo (`ocrit-v1.1` tag — upstream
ships a .pkg, which the bin installer can't extract; the mirrored tar.gz
carries the upstream LICENSE). darwin-only via `platforms` (transcribe
precedent); the linux leg (tesseract) is a filed follow-up. Integration is
**guidance-only** by design: `bakin_exec_pdf_read` mentions the `ocrit` bash
lane when `listCapabilities()` reports the capability ready — the server
never spawns the binary.

## Gotchas

- **Bun caches modules by path, ignoring import attributes**: the
  embedded-assets manifest's `with { type: 'file' }` import of
  curated-catalog.json used to poison the loader's plain JSON import into a
  path string (static catalog silently empty on every source-run server).
  `shippedCatalogRaw()` in `src/core/curated-catalog/load.ts` normalizes;
  pinned by `tests/core/curated-catalog-import-collision.test.ts` (which
  reproduces the poisoning via a fixture — never import the real manifest
  in tests, its file-typed dist imports only exist post-build).
- Skill collections in the wild (badlogic/pi-skills) install by CLONING
  into skills dirs, not `pi install` — the agent-packages projection is the
  right vehicle, not a runtime package manager (spec v3 decision; the
  optional `packages?` contract member stays reserved for a real Pi
  EXTENSION need).
- zod v4 `z.record(enum, …)` is exhaustive — per-platform maps use
  `z.partialRecord`.
