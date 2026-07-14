# Pi Ecosystem — Task Plan

**Status:** APPROVED (Mark, 2026-07-13)
**Spec:** `.claude/specs/pi-ecosystem/SPEC.md` (APPROVED v1)
**Process:** one PR per workstream; branches in the MAIN checkout; Mark tests live on 3737 BEFORE each merge (test-live-before-merge). WS order = value order; each WS is independently shippable.

## Ground-truth corrections found during planning (supersede spec assumptions)

1. **#627 is partially shipped** (pi-parity commits `e37375069`/`30b4106f1`/`7c23a0bf4`; issue stayed open). Working today: codex-OAuth generate+edit incl. reference images (`gpt-image-2`), key-based *generate* via the shared direct shim (`@bakin/core/media` `generateDirectImage`). Actual gaps: **direct-shim edit/multi-ref does not exist** (`edit()` is codex-only), `providers()` advertises only `openai-codex` (never `openai`-by-key or `google`), Gemini untested end-to-end.
2. **Pi extensions already load in Bakin turns** — `piExtensions` policy shipped with default `mode: 'all'` (`messaging.ts:60`), allowlist filtering + policy tests exist (`tests/integration/pi/extensions.test.ts`). #670's remaining scope is the TRUST layer: default flip `all` → `allowlist` (behavior change — see WS4 risk), discovery contract member, approve UI, doctor check, CLI/REST.
3. **npm deps must live OUTSIDE projected skill dirs** (hard constraint): Pi `skills.write` rejects nested paths (`skills.ts:117`), and both drift hashes walk everything (`markers.ts:143` walkSorted / `sync-scanner.ts:558`). WS2 therefore installs the runnable payload (scripts + node_modules) into a Bakin-owned dir recorded as a projection leg; the projected skill is SKILL.md instructions pointing at it.

---

## WS1 — bits release fix (PR 1: bits repo only, no Bakin code)

**Value:** un-breaks fresh-machine onboarding (recommended plugins projects/messaging fail today).

- **T1.1 — Strip tombstoned fields from the template.** `plugins/_template/bakin-plugin.json`: remove `entry` (and `tests` if present) on bits main.
  - Accept: template manifest passes Bakin's `readPluginManifestJson` (no tombstone throw).
- **T1.2 — Publish fresh Whiskit artifacts.** projects@0.7.0 + messaging@0.7.1 from bits main via the existing publish tooling (`src/core/whiskit/publish.ts` / CLI); regenerate cumulative `whiskit-artifacts.json`; create a release marked **latest**.
  - Accept: `releases/latest/download/whiskit-artifacts.json` lists projects 0.7.0 + messaging 0.7.1; downloaded tarballs' packaged manifests contain no `entry`/`tests`.
- **T1.3 — Live verification.** On the box: remove + reinstall both plugins from the catalog source (no `@ref`); run the recommended-plugins onboarding check.
  - Accept: both installs resolve the fresh artifacts and pass validation; onboarding component reports ok.
- Commits: one per task. Rollback: re-point "latest" at the previous release (T1.2 is release-metadata only).

## WS2 — pack requirement legs + three packs (PR 2: Bakin; then bits packs)

**Value:** transcribe / YouTube-transcript / real-browser tasks become completable; machinery reusable for every future script-shaped skill.

- **T2.1 — Manifest schema: three new `requires` legs.** Extend `RequiresSchema` (`manifest.ts:101`) with:
  - `npm: [{ name, dir, packageJson: Record<string,string> (pinned deps), env? }]` — payload dir under `getBakinPaths().home/npm/<packId>@<version>/` (exact key shape may be refined in build; deps EXACT-pinned, no ranges)
  - `models: [{ name, url, sha256, bytes, dest }]` — sha256-pinned download (bin-installer verify pattern), dest under a Bakin-owned models dir; declared `bytes` drives the consent prompt
  - `prereqs: [{ name, kind: 'binary'|'app', probe: string (PATH name or absolute path), help }]` — checked, never installed
  - `platforms?: ['darwin-arm64', …]` pack-level gate (new; per-bin gating stays)
  - Accept: zod round-trips all legs; schema-shape unit tests; tombstone-free.
- **T2.2 — Leg installers + lifecycle wiring.** New `npm-installer.ts` (payload dir + `runSystemBun(['install','--ignore-scripts'])` from `src/core/whiskit/command.ts` — system-bun precedent) and `model-installer.ts` (download→sha256→atomic rename, consent + progress via the onboarding options); both record projections (`kind: 'npm-payload' | 'model'`) and run at ALL FOUR sites (installer parent+deps, updater-first-fail-fast, sync local re-projection best-effort) — the PR #673 bin lifecycle, mirrored. Shared-payload rule: payload dirs are per-pack@version (no sharing → no shared-bin analogue needed); model files MAY be shared (dedupe by dest+sha like shared bins).
  - Accept: bin-survival-suite-style tests per leg — install/upgrade-survival/fail-fast/offline-repair/uninstall; updater tears nothing when an npm install or model download fails.
- **T2.3 — Readiness + doctor legs.** `capability-readiness.ts`: `npm` leg (payload dir present + node_modules populated), `models` leg (dest file present + size sane), `prereqs` leg (`Bun.which` / `existsSync` probe, honest `help` remediation), `platforms` gate (reuse unsupported-platform honesty). Doctor inherits via `checkCapabilities` pass-through (no doctor change).
  - Accept: readiness unit tests per leg incl. remediation strings; runtime-hub Capabilities card renders new legs (RTL).
- **T2.4 — Pack: youtube-transcript** (bits). Pinned `badlogic/pi-skills@90bb51ca…` source; SKILL.md adapted to invoke the payload-dir script; `requires.npm` with `youtube-transcript-plus` exact-pinned. Catalog entries (bits + embedded).
  - Accept: install on live box → readiness ready; agent task "transcript of <video url>" completes.
- **T2.5 — Pack: transcribe** (bits). `requires.bins` (parakeet tarball, upstream sha256 — NOTE: tarball, so bin-installer needs a tar-extract variant or we re-host the raw binary; decide in build, prefer smallest change), `requires.models` (~897 MB gguf, consent prompt), `platforms: ['darwin-arm64']`, prereq `ffmpeg` (optional leg, warn-only).
  - Accept: install pre-fetches model with consent; agent task "transcribe this .m4a" completes; readiness honest on a hypothetical linux-x64 (unit).
- **T2.6 — Pack: browser-tools** (bits). `requires.npm` (pruned dep set — NO full `puppeteer`; `PUPPETEER_SKIP_DOWNLOAD=1` env in leg), prereq `Google Chrome` (`app` probe), SKILL.md adapted (payload-dir paths, headless notes; profile-copy feature documented as human-present).
  - Accept: install on live box; agent task "screenshot example.com + extract readable text of <url>" completes with Chrome running.
- **T2.7 — Docs + knowledge.** `capability-packs.md` (legs, payload-dir rule, the node_modules constraint), `agent-packages.md` schema section, docs site pack-authoring page.
- Commits: T2.1+tests → T2.2 (one commit per installer) → T2.3 → packs one commit each (bits) → docs. Rollback checkpoints: after T2.3 (machinery green, no packs yet), after each pack.

## WS3 — direct-provider images completion (PR 3)

**Value:** all three image use cases (create / edit / multi-ref compose) on BOTH credential lanes (codex subscription, metered keys) and BOTH providers (OpenAI, Gemini); recommendation engine routes to them.

- **T3.1 — Direct-shim input-images support** (`packages/core/src/media/` `generateDirectImage` lineage): OpenAI `images.edit` (gpt-image-1, up to 16 input images) + Gemini image-input generation; typed capability errors when a model can't take input images. This is CORE media code — OpenClaw's shim inherits it free.
  - Accept: unit tests over fake provider endpoints (multi-input, size/format handling, error typing).
- **T3.2 — adapter-pi `providers()` completion** (`images.ts`): advertise `openai` (configured = key present via `resolveProviderApiKeySource`) and `google` alongside `openai-codex`; `edit()` routes: codex route OR direct-shim edit (no longer codex-only); `generate()` with `referenceImages` routes to edit-style invocation on direct providers (#418 semantics).
  - Accept: adapter unit tests (fake endpoints, both lanes, provider-down honesty); `providerReadiness` integration — `routable` true per key/auth presence, `servedBy` correct.
- **T3.3 — Codex lane verification + pin.** Live-verify gpt-image-2 codex generate/edit/multi-ref (exists, shipped — this is a regression check not new code); pin with a workaround-regressions-style test if any upstream quirk is being relied on.
  - Accept: live battery — the three use cases × (codex, openai-key, gemini-key) matrix; billed-media gate + idempotency untouched (existing plugin suites green).
- **T3.4 — Docs + close #627.** `pi-adapter.md` images section, `models-plugin.md` if provider listing semantics changed.
- Commits: T3.1 → T3.2 → T3.3 (test-only) → docs. Rollback: T3.1 is additive core; revert = adapter falls back to codex-only (current behavior).

## WS4 — extension trust lane (PR 4)

**Value:** Pi's extension ecosystem works in Bakin turns behind an honest, one-click trust flow instead of silently-on.

- **T4.1 — Neutral contract member.** `extensions?: { list(): Promise<RuntimeExtensionInfo[]> }` on the adapter contract (optional, feature-detected — `.extensions?.`, arch-test pattern). `RuntimeExtensionInfo = { id, label, source, path, status: 'allowed'|'pending'|'blocked', origin: 'consented'|'external' }` — neutral shapes only (no Pi identifiers upstream; loading stays in adapter-pi).
  - Accept: arch-test additions (ban `.extensions!.`); conformance: mock runtime omits the member.
- **T4.2 — Adapter discovery + policy default flip.** adapter-pi implements `extensions.list()` (enumerate `~/.pi/agent/extensions/` + settings.json packages, adapter-private); `extensionsPolicy()` default flips `'all'` → `'allowlist'`. **Behavior change:** terminal-installed extensions stop loading until approved — the approve flow + doctor pointer make this honest. `extension_error` containment verified with a mid-turn-throw fixture (event handler if the SDK surfaces one; a broken extension never kills a turn).
  - Accept: policy matrix tests updated (default = allowlist-empty); extension fixtures (loads / throws-at-load / throws-mid-tool / calls-ctx.ui-headless) all leave turns alive.
- **T4.3 — REST + CLI.** `GET /api/runtime/extensions`, `POST /api/runtime/extensions/allow|revoke` (request-handler.ts, writes the `piExtensions.allow` list via settings); `bakin runtime extensions list|allow <id>|revoke <id>` in `src/cli/commands/runtime.ts`.
  - Accept: route tests; CLI smoke; settings round-trip (watchdog-style live re-read — no restart needed for policy changes since sessions are per-turn).
- **T4.4 — Hub UI + doctor.** Extensions section on the Runtimes tab (active-runtime-gated, feature-detected); approve/revoke via ConfirmDialog (children slot for the D7 trust + spend disclosure; `confirmVariant="default"` for approve, destructive for revoke); pending-extensions check in adapter-pi `health-checks.ts` (`pi.extensions`) pointing at the hub.
  - Accept: RTL tests (pending → approve flow → allowed; disclosure copy present); doctor check unit; no-inline-actions rule holds.
- **T4.5 — Docs + close #670/#626.** `pi-adapter.md` extensions section, `runtime-capabilities.md` contract member, user docs page (trusted-code + spend disclosure language).
- Commits: T4.1 → T4.2 → T4.3 → T4.4 → docs. Rollback checkpoint after T4.2 (policy + containment green, no UI yet). The default flip rides T4.2 and reverts with it.

## Cross-cutting

- **Testing:** every new test file follows the content-dir/OPENCLAW_HOME/PI_HOME isolation rules; Bun.serve fixtures use NativeResponse/nativeFetch; RTL files import rtl-settle.
- **Verification cadence:** per-task `bun test <files>`, per-WS full `bun run test` + typecheck + live-box check before handing to Mark.
- **Review:** high-effort code-review workflow before each PR is opened for merge (the PR #673 cadence).
- **Docs:** knowledge docs updated inside each WS (listed per-WS above); README untouched (no user-facing surface changes at that level) unless pack-authoring docs warrant a pointer.
- **Issue hygiene:** #627 closes with WS3, #626+#670 close with WS4, #671 closes with WS1+WS2.

## Sequencing & dependencies

WS1 (independent, smallest) → WS2 (machinery before packs; packs depend on T2.1–T2.3) → WS3 (independent of WS2) → WS4 (T4.4 touches the same hub components as WS2's T2.3 readiness rendering — sequential PRs avoid conflicts). WS3 and WS4 could swap if image parity is hotter.
