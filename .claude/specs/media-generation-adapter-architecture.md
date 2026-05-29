# Media Generation Adapter Architecture

Status: **Phase 1 done; Phase 2 in progress.** Landed in Phase 2: native-path
retry parity, capability-contract tightening (dropped `outputPath`), shim
namespace settled (`@bakin/core/media`), and the Bakin-owned provider secret
store (env → store, `0600`). Remaining: the dashboard secret field + REST write
API, and the Hermes adapter when a 2nd runtime is actually built.
Scope: image generation today; the template generalizes to video / audio / any
provider-backed media modality and to runtimes beyond OpenClaw.

## Problem

The `images` plugin currently owns two things it should not:

1. **Provider transport** — `OpenAIImageAdapter` / `GeminiImageAdapter` make
   direct HTTPS calls to OpenAI / Gemini, duplicating what the runtime adapter
   already does and re-introducing the code the branch claimed to retire.
2. **Credential extraction** — `resolveImageApiKey` reaches into
   `ctx.runtime.config.get().models.providers.*.apiKey` to pull provider secrets
   out of the runtime's raw config (the sole reason the plugin needs the
   `runtime.read` permission).

This couples a domain plugin to (a) provider API contracts and (b) one runtime's
config shape. It does not survive a second runtime, and it forces every future
media plugin (video, audio) to re-implement the same provider/credential logic.

This is the inverse of the intended boundary: **capability gaps in a runtime
should be filled below the plugin, in the adapter layer — never in the plugin.**

## Decision: four layers

```
Plugin (images, video, audio…)         Domain + UX: surface profiles, routing
   │  speaks ONLY the capability iface   policy, asset persistence, prompt
   ▼                                      packaging, QC. Provider- AND
                                          runtime-agnostic. Owns NO secrets and
                                          NO provider HTTP.
Capability contract                      The stable interface every runtime
   │  (RuntimeImagesAccess, future        adapter implements. Defined by what
   ▼  RuntimeVideoAccess, …)              PLUGINS need, sized to survive ≥2
                                          runtimes. Gaps fall DOWN, never up.
Runtime adapter (openclaw, hermes…)      Maps the contract to one runtime.
   │  per-runtime: discovery, native      Decides when it cannot serve a request
   ▼  path, gap policy, credentials       and delegates to the shared shim.
Shared direct-provider transport         Runtime-agnostic provider HTTP (OpenAI,
   (+ Bakin-owned secret source for       Gemini, FAL, Runway…). Written ONCE,
    services no runtime fronts)           reused by every adapter and modality.
```

The plugin only ever calls `ctx.runtime.images.*`. Everything about *which
provider, over what transport, with whose key* is resolved at or below the
adapter.

## Two gap types and credential ownership

A request for `provider/model` resolves in one of three ways. The plugin is
blind to which — it just calls `generate()`:

1. **Runtime serves it natively.** Adapter delegates to the runtime
   (OpenClaw `infer image`, etc.). The runtime owns the credential; Bakin never
   sees it. *Normal case — no Bakin key involved, no double entry.*

2. **Runtime knows the provider but cannot serve this request** (old build,
   model not in its list, capability disabled). The adapter fills the gap via
   the shared shim. **Key comes from a Bakin-owned secret source**, not by
   borrowing the runtime's key — because (see Hermes below) the runtime may not
   expose an extractable key at all. Borrowing is fragile and runtime-specific;
   a Bakin-owned secret is uniform.

3. **No runtime fronts the provider at all** (e.g. a brand-new service no
   adapter knows). Legitimately Bakin-owned territory: a Bakin secret + the
   shared shim. You cannot ask a runtime to own credentials for a service it has
   never heard of.

Credential resolution is therefore **per-adapter for the native path, and
Bakin-owned for the shim**; transport is **shared**. This is what eliminates
duplication across runtimes and modalities. The plugin owns no secrets in any
case.

Note: the shim only fires when the runtime *cannot* serve the request, so the
"Bakin needs its own key" cost is incurred exactly when there is no runtime key
to borrow anyway. There is no double-entry burden in the normal (native) path.

### Bakin-owned secret store (shim credentials)

The shim's keys are **provider** credentials (openai, gemini, fal, runway…),
*not* plugin credentials — the same key may serve image, video, and future
modalities. So the store is keyed **per provider**, not per plugin. (This rules
out per-plugin manifest `secrets` as the primary store: it's the wrong grain and
forces every media plugin to re-declare the same provider keys.)

Target shape: a **central, provider-keyed, settings-backed store**, built
defensively:
- **Resolution order:** env var (override) → stored secret → unavailable. Power
  users / CI keep keys out of disk via env; everyone else uses the dashboard and
  it just works without a restart.
- **Dedicated file, `0600`**, separate from the broadcast `settings.json` so a
  secret never rides an SSE frame or a settings export.
- **Write-only / masked API:** reads return `set: true|false` + a masked hint,
  never the value. Requires a real "secret" field type in the settings renderer.
- **Excluded** from any export/backup path that isn't secrets-aware.

Critical drawback driving the design: **plaintext at rest** in `~/.bakin/`. The
mitigations above shrink it to an acceptable risk for a single-user Mac mini
behind Tailscale. If plaintext-at-rest is unacceptable, the fallback is env-only
forever (accepting the UX cost); macOS Keychain is a possible later hardening but
is painful from a launchd daemon, so it is not the baseline.

Sequencing: **Phase 1 uses env only** (simplest Bakin-owned source, already
declared in the images manifest). The settings-backed provider store + secret
field type land in **Phase 2** — no UI is built before the shim exists to use it.

## Capability-contract principle

- The contract (`RuntimeImagesAccess` and siblings) is defined by **plugin
  needs**, not by any runtime's CLI/tool vocabulary.
- It must map cleanly onto **at least two structurally different runtimes**
  before we lean on it (OpenClaw + Hermes — see validation).
- **Optional capability fields are expected, not a smell.** A thin runtime that
  exposes a single media tool maps on by filling minimal fields; a rich runtime
  fills more. Plugins must treat a sparse capability as normal and lean on the
  shim — they must never require fields a thin runtime can't provide.
- Remaining cleanups for the contract (not a rewrite): `outputPath` is a
  file/CLI concept leaking into the contract; a runtime returning bytes/URL
  shouldn't have to invent a path.

## Validation against a second runtime: Hermes

Source: https://github.com/nousresearch/hermes-agent (Nous Research). Verified
2026-05-28 via its README. Hermes is structurally different from OpenClaw, which
is exactly why it is a good stress test.

| Contract assumption | OpenClaw | Hermes |
|---|---|---|
| `providers()` = rich provider × model matrix with `configured`/`capabilities` | `infer image providers --json` — native fit | **No equivalent.** Image gen is one tool (FAL, routed via Nous Portal); `hermes tools` lists tools, not image providers. Adapter must **synthesize** a provider list. |
| Runtime exposes extractable provider API keys | Keys in OpenClaw config — extractable | **Often not.** Image gen routes through a Nous Portal subscription; there may be no raw FAL/OpenAI key to borrow. |
| Bakin drives a one-shot generation call | `exec(['infer','image',…])` | TUI / messaging gateway / Python-RPC; no documented REST/SDK. One-shot calls are awkward. |

What Hermes forced into this design:

1. **The shim is first-class, not a rare fallback.** Hermes only does FAL —
   wanting gpt-image/Gemini through Hermes is a gap on *every* such request, not
   an edge case. The shared transport must be properly built and tested, not
   tolerated as bit-rotting plugin code. (This is why "just delete the native
   adapters and forget it" is wrong: the capability moves down and gets
   **promoted**, not deleted.)
2. **Never assume an extractable runtime key.** Drove the "Bakin-owned secret
   for the shim" rule in gap types 2/3.
3. **Optionality in the contract is load-bearing** — it's what lets Hermes map
   on at all.

Conclusion: the plugin-layer cleanup (plugin → runtime-only) survives
validation. We are not painting into a corner; we would only have under-built
the shim had we treated it as a rare fallback.

## Media-modality template

`video` and `audio` plugins follow the identical pattern:
- A parallel capability contract (`RuntimeVideoAccess`, etc.), plugin-driven.
- The same shared direct-provider transport (extended with the new modality's
  providers — Runway/Kling/Seedance for video, etc.).
- The same Bakin-owned secret source for services no runtime fronts.
- The plugin stays a thin domain layer (surfaces, routing policy, asset
  persistence, QC) and owns no transport or secrets.

A new modality plugin should be implementable without touching provider HTTP or
credential code — that is the test that this architecture is working.

## Phase plan

**Phase 1 — plugin → runtime-only + shared shim (this branch / next).** Stop the
boundary violation and build the shim shared from day one (we know the 2nd
runtime needs it).
- Remove `OpenAIImageAdapter`/`GeminiImageAdapter` and `credentials.ts` from the
  `images` plugin. The plugin calls only `ctx.runtime.images`.
- **Build the direct-provider transport as a shared, runtime-agnostic module**
  from the start (location TBD: `packages/core/src/media/direct-image-provider.ts`
  or a small `@bakin/media-direct` package). The OpenClaw adapter *composes* it
  as its gap-fill path; future adapters reuse it unchanged.
- Credentials for the shim come from a **Bakin-owned secret**, **env only** in
  this phase (`OPENAI_API_KEY`/`GEMINI_API_KEY`, already declared in the images
  manifest `secrets`), resolved at the adapter and passed into the shim — never
  read from runtime config.
- Revert the `runtime.read` grant added for credential extraction (unnecessary).
- **Serving-path surfacing ("how"):** extend the existing
  `routeSource: 'runtime' | 'native'` so (a) `recommend` predicts the serving
  path before generation, (b) provider readiness reports it, (c) the shim path
  names its credential source — so "not working as expected" is debuggable
  ("this route will be served by a Bakin-side key, not the runtime").
- Add an image-capable Imitation Crab fixture
  (`dev/imitation-crab/fixtures/openclaw.json` models no image providers today)
  so `dev:mock` exercises both the native and gap-fill paths.

**Phase 2 — secret store + contract tightening.**
- [x] Native-path retry parity (the native OpenClaw path now retries transient
  errors, matching the shim).
- [x] Tighten the capability contract — dropped the `outputPath` leak; the
  adapter owns the output path. Documented the thin-runtime mapping expectation.
- [x] Settle the shim namespace — `@bakin/core/media` (no standalone package).
- [x] Bakin-owned provider secret store — `~/.bakin/secrets.json` (`0600`,
  dedicated file), provider-keyed, resolution order env → store. The shim path
  and readiness/`servedBy` consult it. Populated via env or by editing the file.
- [ ] **Remaining:** dashboard secret field type + REST write API (set/unset/
  masked-status) so keys are editable from the UI rather than by hand. Resolved
  ownership: a dedicated core module (`@bakin/core/media/secret-store`), NOT the
  per-plugin settings infra (provider grain, shared across modalities); the UI
  field type rides the existing settings renderer.
- [ ] Build the Hermes adapter against this to confirm the abstraction
  (synthesized `providers()`, no extractable key → store/shim-only).

## Non-goals

- Building the Hermes adapter now (validated against docs only).
- A generic "any provider over raw HTTP" engine — provider support stays
  adapter/descriptor-based (a new provider = a descriptor + shim entry + tests),
  not arbitrary user-supplied endpoints.
- Changing how the runtime owns its *own* auth (Codex OAuth etc. stay inside the
  runtime).

## Resolved decisions

- **Shared shim from day one** — built as a runtime-agnostic module in Phase 1,
  not adapter-local-then-extracted (Hermes proves the 2nd runtime needs it).
- **Secret store shape** — central, provider-keyed, settings-backed, with env
  override + write-only/masked API + `0600` dedicated file. Env-only in Phase 1;
  full settings store in Phase 2. (See §Bakin-owned secret store.)
- **Surface the serving path ("how")** — `recommend` predicts native-vs-shim,
  readiness reports it, the shim names its credential source. Phase 1.

## Open questions

- ~~Exact package boundary/home for the shared shim.~~ **Resolved:** lives in
  `packages/core/src/media/`, exported as the `@bakin/core/media` namespace. No
  standalone package — a single-binary Bun build gains nothing from the extra
  package wiring, and core is already the shared dependency for adapters + host.
  Future modalities (video, audio) add sibling transports under the same
  namespace.
- ~~Whether the secret store is owned by a dedicated concern or rides the
  existing settings infra.~~ **Resolved:** a dedicated core module
  (`@bakin/core/media/secret-store`), keyed per provider (shared across
  modalities); the future dashboard editing rides the existing settings
  renderer via a new "secret" field type.
