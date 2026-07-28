# Skill Hub Interop (#687)

Install Agent-Skills-format skills (ClawHub, GitHub skill repos, local dirs) onto
whichever runtime is active. Spec: `.claude/specs/skill-hub-interop/SPEC.md` (v2);
observed ClawHub API shapes: `.claude/specs/skill-hub-interop/API-NOTES.md`.

## Design center

- **Paste-a-link is the interface.** `bakin skills install <anything>` and the Explore
  "Hub Skills" tab both accept pasted clawhub.ai/github.com page URLs, scheme refs
  (`clawhub:@owner/slug[@version]`, `github:owner/repo[@ref]#subpath`), and local
  paths — all funneled through ONE pure normalizer
  (`src/core/agent-packages/ref-normalize.ts`).
- **One engine, zero parallel machinery.** A raw bundle (SKILL.md at root, no
  `bakin-package.json`) is synthesized IN STAGING into a normal skill-pack; the
  existing installer/projector/lockfile/readiness/sync/uninstall pipeline runs
  unchanged. Synthesis lives at the fetch chokepoint (`ensureInstallableStaging` in
  `source-fetcher.ts`), so installer, updater, and dependency resolution all inherit
  raw-bundle support.
- **The frozen table (D12).** `skill-synthesis.ts` translates EXACTLY the
  `metadata.openclaw` namespace (requires.env/bins/anyBins, envVars, primaryEnv, os)
  into Bakin legs: env vars → `secrets[]` with CORE-MINTED `skills.<NAME>` slots;
  binaries → probe-only `prereqs` (never auto-installed — the ClawHavoc vector); os →
  `platforms`. `FROZEN_TRANSLATION_KEYS` is test-pinned — NEVER extend it; new
  dialects route to the agent mapping lane. Everything unrecognized surfaces loudly:
  raw metadata verbatim in the preview + a claim-free env-var mentions scan.
- **Extensibility = agents, not parsers.** `bakin skills map <name>` dispatches an
  ephemeral system turn (work class `skill-mapping`, cheap-routed, metered) on the
  INSTALLED (post-consent) bundle; the proposal is schema-parsed then mechanically
  verified (`skill-mapping.ts`): only names literally present in the bundle survive,
  slots are always core-minted `skills.*`, apply re-verifies the wire payload and
  amends the installed manifest atomically (+ synthesized `capability` slug so
  readiness lights up). Porter prompt ships in core; a bits `skill-porter` skill can
  supersede the smarts without a release. Update/sync re-synthesis invalidates
  applied mappings by construction — documented semantics.
- **Official lane = bits.** Blessed skills get ported into `bakin-bits-official` as
  full capability packs; the paste-ref path is for the long tail.

## Trust gate (skill-trust.ts)

Two-phase consent reusing the plugin `consent-token` module: `buildSkillPreview`
fetches → assembles the preview (files+sizes, translated legs, raw metadata,
mentions, instruction-risk findings, hub badge) → signs a token bound to
(canonical ref, staging `computeDirSha`) → tears staging down. `confirmSkillInstall`
re-fetches + re-hashes; drift bounces to a FRESH preview. Hard refusals (never
overridable, enforced at ENGINE level in the fetch layer so direct
`bakin packages install clawhub:…` is equally gated): ClawHub moderation flags,
scanner `DO_NOT_INSTALL`, unrecognized verdict semantics (fail closed — only
endpoint *unreachability* earns the soft `unverified` label), per-file sha mismatch,
unsafe listed paths, size caps (512 files / 20 MB), **binary files** (0/30 top hub
skills have any — refused honestly, not silently corrupted). The deterministic
instruction-risk scan (curl/wget-pipe-shell, base64-exec, remote-powershell,
eval-download) is a loud preview warning — the run-time ClawHavoc vector made
visible; it never blocks. Audit events: `skill.hub.{installed,refused,mapped}` +
standard `pkg.*`.

## ClawHub client (clawhub-client.ts)

Four anonymous read endpoints, shapes pinned to LIVE observations (API-NOTES.md),
zod `.passthrough()` on consumed fields only: skill detail (ambiguous bare slugs →
`AmbiguousClawhubSlugError` with an owner-picker matches list; disambiguation is the
`?owner=` query param), versions list, version detail (**per-file sha256 manifest +
embedded security verdict** — this is why there is NO zip handling and no archive
dependency: files download individually and verify against their pins), per-file
content. `/skills/{slug}/scan` is the moderation surface (`/moderation` is
authed/unavailable). An arch-pin test keeps client imports + raw API URLs inside
{clawhub-client, source-fetcher, skill-trust}.

## Surfaces

- CLI `src/cli/commands/skills.ts`: `install <url-or-ref> [--yes]` (preview render →
  consent → install → capability readiness + guided key via the packages helpers;
  drift re-prompts once), `list` (managed `[hub|pack]` + unmanaged runtime skills),
  `remove <name>` (bare names, D19 — lockfile keys stay `hub-<name>@<ver>`),
  `map <name> [--yes]`. **No update verb** — re-running `install <ref>` re-runs the
  gate and re-pins.
- REST `packages/host/src/api/skills.ts`: `GET /api/skills`,
  `POST /api/skills/{preview,install,map/preview,map/apply}`. Removal rides
  `DELETE /api/packages/{lockKey}`.
- Explore `plugins/explore/components/hub-skills-section.tsx`: the ecosystem lane
  INSIDE the Capabilities tab (unified surface — never a separate tab; grouping is
  installed-vs-available, never by source): one "Installed" list for curated packs
  AND hub installs (source chips, ConfirmDialog removal), then "Get more
  capabilities" — paste-a-link CTA (trust preview in a BakinDrawer) + the curated
  grid filtered to not-yet-installed entries.

## Adjacent changes shipped with #687

- **adapter-pi nested skill files + exec bits** (shared helpers
  `packages/core/src/adapters/runtime/skill-files.ts`): both adapters chmod 755
  shebang/script-extension files; Pi reads/writes full trees (flat-only guard
  replaced by `isSafeSkillFilePath` — traversal still validated before first write).
- **D14**: `manifest.runtimes`/`platforms` enforced server-side at install (parent +
  deps), audited `pkg.install_refused`. Readiness's platform leg now guards only
  post-install drift.
- **D18**: secret saves live-inject declared env vars (unset-only, env wins) via
  `injectSecretEnvForSlot`; boot now also collects PACK-declared secretSlot mappings
  (`collectPackSecretMappings`) — previously only the static list injected.
- New system work class `skill-mapping` in the routing matrix (routable,
  recommended-cheap; the models.routing doctor check will flag it unrouted until
  routed — apply-recommended covers it).

## Gotchas

- ClawHub slugs are NOT unique — always carry `owner` once resolved; bare-slug
  endpoints 409/matches on ambiguity.
- The `hub-` id prefix is internal; every user surface speaks bare skill names.
- `sourceSpecWithRef` leaves `clawhub:` sources untouched — an unpinned source
  re-resolves latest on update-by-reinstall; an `@version`-pinned source stays pinned.
- clawhub: is async-only (`fetchSource` sync path throws; the updater moved to
  `fetchSourceAsync`).
- Compound lockfile keys keep their ORIGINAL version across updates
  (`hub-x@1.0.0` may hold `version: 2.0.0`) — engine semantics; resolve by prefix,
  read `entry.version` for truth.
