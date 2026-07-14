# Pi Ecosystem: Extension Trust Lane, Capability-Pack Fast-Follows, Native Images

**Status:** APPROVED v1 (Mark, 2026-07-13)
**Issues:** #670 (extension trust lane), #671 (fast-follow packs + release fix), #627 (Pi native images)
**Date:** 2026-07-13
**Prior art:** `.claude/specs/pi-parity/SPEC.md` (D1–D15, §10.2 banked lane design), PR #673 (capability-pack repair correctness)

---

## 1. End-user value (why each piece exists)

| Workstream | What a user can do after | Without it |
|---|---|---|
| WS1 — bits release fix | Fresh install: recommended plugins (projects, messaging) actually install during onboarding | First-run onboarding FAILS on both recommended plugins today |
| WS2 — three capability packs | "Transcribe this meeting recording", "pull the transcript of this YouTube talk", "check what this page actually renders / screenshot it" become completable tasks, installed in one click with keys/bins/models handled | Users hand-assemble scripts, binaries, and models per agent |
| WS3 — native Pi images (#627) | Agents on Pi create images from prompts, edit existing assets, and compose from multiple reference images ("this bear, but doing the polka") — full OpenClaw image parity, spend inside budget caps | Image tasks fail typed on Pi; the edit→version asset chain doesn't exist |
| WS4 — extension trust lane (#670) | A user who runs `pi` in the terminal sees their installed extensions work in Bakin turns — after a one-click, honest approval. Pi's package ecosystem (5,288 packages) stops being silently dead inside Bakin | Terminal-installed extensions silently don't load (`noExtensions: true`); users conclude Bakin breaks Pi |

Priority rationale: WS1 is an onboarding-breaking bug (highest value/effort ratio). WS2/WS3 create new completable task types. WS4 is ecosystem expectation — Pi's architecture ships extensions as a first-class concept, so Bakin must have a deliberate trust answer, not a silent `noExtensions`.

## 2. Decisions (interview 2026-07-13)

- **D1 — #670 ships in full, trust-manage only.** Discovery of terminal-installed extensions + approve/revoke UI + allowlist policy. Bakin does NOT install extensions this round (an install surface can layer onto Explore later). Mark's call: users expect Pi plugins to work; it's core Pi architecture.
- **D2 — #627 is in scope, full parity surface.** Create from prompt, edit an existing image, and generate from 1..n reference images. The `RuntimeImagesAccess` contract already models all three (`generate`, `edit(files[])`, `referenceImages[]` — #418 semantics). No contract changes.
- **D3 — Image providers: OpenAI + Gemini, matching the images-plugin routing engine.** Adapter `providers()` speaks the same provider ids (`openai`, `google`) the images plugin's readiness expects; `resolveImageRoute`/`recommendImageRoute` stay untouched. OpenAI must work with EITHER the Codex subscription token (subscription lane, no metered dollars) OR a metered API key (billed-media gate). Gemini via `GEMINI_API_KEY`.
- **D4 — Browser-tools ships via new npm-deps pack machinery.** Capability packs gain a `requires.npm` leg: pack install runs an in-binary `bun install` in the projected skill dir (same pattern as user-plugin deps). Chrome-installed becomes a doctor-checked prerequisite leg. Reused by youtube-transcript.
- **D5 — Transcribe pre-fetches its model at install.** The ~897 MB parakeet model downloads during pack install (progress + consent, mirroring `bakin install search-models`), never during an agent's first task. Pack declares `platforms: ['darwin-arm64']`; readiness reports unsupported-platform honestly elsewhere.
- **D6 — Release fix is bits-side, no Bakin schema change.** Publish fresh Whiskit artifacts (projects 0.7.0, messaging 0.7.1) from bits main, mark that release "latest" with a regenerated cumulative `whiskit-artifacts.json`, strip `entry` from `plugins/_template/`. The `entry`/`tests` tombstones in Bakin's manifest parser are deliberate and stay.
- **D7 — Extension spend honesty.** The approve UI states plainly when an extension is trusted code in-process and that any API keys it uses spend OUTSIDE Bakin's budget caps. This is disclosure, not gating — in-process extension tool calls are invisible to the spend engine by nature.

## 3. Research findings (2026-07-13, three-agent survey)

### Upstream skills (`badlogic/pi-skills`, MIT, pin `90bb51cae36515a648515b633a81c0c6efc8c74d`)
- **youtube-transcript** — one ~50-line script + `youtube-transcript-plus` (zero-dep npm). Captions only (no media download). Any platform, no key. EASY.
- **transcribe** — `parakeet-cpp-transcribe` binary, 904 KB tarball, upstream-published sha256 (`badlogic/pibot@parakeet-cpp-transcribe-v0.1.2`). Fully local (no key; README's Groq line is stale). Model `tdt-0.6b-v3-q8_0.gguf` (~897 MB) auto-downloaded by the binary on first run — override path via `PARAKEET_CPP_MODEL_PATH`. darwin-arm64 ONLY. `ffmpeg` needed for non-WAV input (optional prerequisite leg). EASY-MEDIUM.
- **browser-tools** — 8 Node scripts + npm tree (`puppeteer-core` connect-only, readability/jsdom/turndown/cheerio). Drives the SYSTEM Chrome via CDP :9222 (hardcoded macOS app path); no bundled browser, but the stray full-`puppeteer` dep pulls Chromium unless pruned/`PUPPETEER_SKIP_DOWNLOAD=1`. macOS-bound as written. MEDIUM-HARD → the D4 machinery.
- None of the three is an extension — all plain skills.

### Pi extension ecosystem (pi.dev/packages — 5,288 packages)
- Extensions are TS modules loaded in-process via jiti; registered via `pi.registerTool`; discovered from `~/.pi/agent/extensions/` and project `.pi/extensions/`; `pi install npm:<pkg>` records into settings.json `packages[]`.
- Headless contract is first-class: `ctx.hasUI` guard, `ctx.ui` no-ops in json/print modes. Pi docs state extensions run unsandboxed with full system permissions — the allowlist lane is the right shape.
- Notable: `pi-mcp-adapter` (MCP bridge, one `mcp()` proxy tool), `@ssweens/pi-image-gen` (multi-provider `generate_image`; headless-capable; env-var keys), Codex-token image variants (`pi-codex-image-gen` et al. ride the ChatGPT subscription token for gpt-image-2 — the proof that a Codex image lane exists), subagents/memory/LSP/permission extensions.
- Image-gen-as-extension was REJECTED as the runtime.images backing: its spend bypasses the ONE spend engine (D7 disclosure applies if a user allowlists it anyway).

### Bits `entry` bug (exact mechanism)
- Bakin tombstones `entry`/`tests` in `packages/core/src/plugins/manifest.ts:458-470`; install path rejects at `validate-manifest.ts:92`.
- Installer prefers published Whiskit artifacts (`resolve-source.ts:195-216`); no-ref github source → `releases/latest/download/whiskit-artifacts.json` (`github-resolver.ts:49-52`).
- GitHub "latest" for bits is `projects-v0.5.1`, whose artifacts (projects 0.5.1, messaging 0.5.1) contain BOTH tombstoned fields. Bits main manifests were already fixed (bits `3e25826`); the artifacts were never republished. `plugins/_template/bakin-plugin.json:7-10` still carries `entry`.
- Artifact-match-then-manifest-fail is a hard error by documented design — fallback-to-clone never triggers.

## 4. Workstreams

### WS1 — bits release fix (no Bakin code)
1. Strip `entry` from `plugins/_template/bakin-plugin.json` on bits main.
2. Publish Whiskit artifacts for projects@0.7.0 + messaging@0.7.1 via the existing publish tooling (`src/core/whiskit/publish.ts` + CLI); regenerate cumulative `whiskit-artifacts.json`; mark the new release "latest".
3. Verify on the live box: `bakin plugins install github:markhayden/bakin-bits-official#plugins/projects` resolves the fresh artifact and passes validation; run the recommended-plugins onboarding component check.

### WS2 — npm-deps machinery + three packs
Bakin side:
- `bakin-package.json` schema: `requires.npm` (per-skill or pack-level: `{ skill: string, install: true, prune?: string[], env?: Record<string,string> }` — exact shape at plan time). Pack install/sync/repair runs in-binary `bun install` in the projected skill dir; lockfile projections record the installed state; readiness gains an `npm` leg with honest remediation.
- Prerequisite checks: declared `requires.prereqs` (e.g. `chrome`, `ffmpeg`) surface as doctor findings + readiness legs — Bakin does NOT install prerequisites this round.
- Model pre-fetch: `requires.models` leg (url + sha256 + destination) downloaded at install with progress/consent — generalizes the search-models pattern (transcribe is the first consumer).
- Platform gating: packs declare `platforms`; readiness's existing unsupported-platform leg (just fixed in #673) reports honestly.
Bits side: three new packs (`browser-tools`, `transcribe`, `youtube-transcript`) pinned to `badlogic/pi-skills@90bb51ca…`, with adapted SKILL.md content per runtime conventions, catalog entries (bits `catalog.json` + embedded `curated-catalog.json`), Explore listings.

### WS3 — native Pi images (#627)
- `packages/adapter-pi/src/images.ts` implementing `RuntimeImagesAccess`:
  - `providers()` → `openai` (codex-token OR `OPENAI_API_KEY`) + `google` (`GEMINI_API_KEY`), readiness-compatible with the images plugin's provider ids and the routing engine.
  - `generate()` — prompt-only native generation; `referenceImages[]` routes through the edit-style invocation (#418 semantics).
  - `edit(files[])` — multi-input-image edits (gpt-image-1 accepts up to 16 input images; Gemini equivalent verified at build time).
- Credential resolution: metered keys from Bakin's secret store (never Pi's auth.json); Codex token detected from Pi auth — **build-time verification item:** the exact endpoint/model the Codex token authorizes (the `pi-codex-image-gen` lineage proves it exists; we verify and pin the mechanism before relying on it, and fail honest if the token lane is unavailable).
- Billing lanes: metered calls ride the existing billed-media gate + ledger idempotency rows (already upstream of the adapter); Codex-token calls are subscription-lane (token accounting, never shown as dollars).
- Capability flags: minimal-honest per the contract's optional image fields.

### WS4 — extension trust lane (#670)
- `settings.runtime.settings.piExtensions`: `{ mode: 'none' | 'allowlist' | 'all', allow: string[] }`, default `allowlist` with empty allow (== today's behavior).
- Adapter (`messaging.ts`): drop `noExtensions` per policy; pass discovered+allowed extension paths; subscribe `extension_error` events → log + continue (a broken extension NEVER kills a turn).
- Discovery: enumerate `~/.pi/agent/extensions/` + settings.json `packages[]` (read-only — adapter-private paths stay behind the adapter boundary; surfaced through a neutral contract method, exact shape at plan time).
- Approve UI: runtime hub section (placement decided at plan time — likely an Extensions group on the Runtimes tab, Pi-active only). Approve/revoke via ConfirmDialog per the no-inline-actions rule, with the D7 spend/trust disclosure. Doctor check points pending extensions at the hub.
- Docs: allowlisted extensions are trusted code in-process; headless behavior expectations (`ctx.hasUI`).

## 5. Boundaries

- **Always:** adapter boundary (provider details behind adapter packages; neutral contract members only — arch-test enforced); ONE spend engine (no parallel image-spend math); no-inline-actions UI rule (everything actionable in ConfirmDialog); honest readiness legs (never claim "missing" for unsupported-platform etc.); tests mock both content-dir paths + runtime homes; knowledge docs updated with the change.
- **Ask first:** any new contract member on `AgentRuntimeAdapter`; any Explore/install surface for extensions (out of scope per D1); prerequisite auto-install (out of scope per WS2).
- **Never:** backwards-compat shims (single-user machine); extension code execution outside the allowlist; image calls that bypass the billed-media gate on the metered lane; touching `~/.pi` write-side outside adapter-owned paths.

## 6. Testing strategy

- **WS2:** pack-install integration tests over Bun.serve fixtures (npm leg: fixture package; model leg: fixture blob with sha256; platform gating; readiness legs incl. prereqs). Repair/sync/uninstall parity via the bin-survival suite pattern (PR #673).
- **WS3:** fake image provider endpoints in the adapter-pi harness (generate/edit/multi-ref, both credential lanes, provider-down honesty); images-plugin readiness/routing integration (providers() speaks the right ids); runtime-conformance additions only if the suite already covers images for OpenClaw (match, don't invent).
- **WS4:** fake extension fixtures through the fake-provider harness — one registering a tool, one throwing at load, one throwing mid-tool-call, one calling `ctx.ui` headless; policy matrix (none/allowlist/all); discovery + approve flow RTL tests on the hub.
- **WS1:** live-box verification (install both plugins fresh) + the onboarding component check.

## 7. Commands

Unchanged surfaces: `bakin packages install|sync|remove`, `bakin check capabilities`, `bakin install agent-sync`. New: extension approve/revoke via the hub REST (`/api/runtime/extensions/*`, exact routes at plan time) — CLI parity (`bakin runtime extensions list|allow|revoke`) decided at plan time.

## 8. Open items pinned for plan/build

1. Codex-token image endpoint/model verification (WS3 — the one true unknown).
2. Gemini multi-reference-edit capability + API shape.
3. `requires.npm` / `requires.models` / `requires.prereqs` exact schema shapes.
4. Extensions discovery contract member shape (adapter-neutral).
5. Approve-UI placement on the runtime hub.
6. PR/commit strategy per workstream (plan phase; one PR per workstream is the working assumption, WS1 first).
