# Images Plugin

Core plugin id: `images`.

The images plugin owns provider-routed image generation primitives. It speaks
*only* the runtime image capability (`ctx.runtime.images`) — it no longer owns
any provider HTTP transport or credential handling. The active runtime adapter
serves a route natively when it can, or composes the shared
`@bakin/core/media/direct-image-provider` shim when it can't (gap-fill). The
plugin's job is domain/UX: surface profiles, routing policy, asset persistence,
prompt packaging, and QC. Generated and imported files are persisted through the
Assets plugin, so downstream workflows should pass canonical asset filenames
such as `image_filename`, not local filesystem paths.

See `.claude/knowledge/media-generation-adapter-architecture.md` for the four-layer
model (plugin / capability contract / runtime adapter / shared shim) and the
credential-ownership rules.

## Tools

- `bakin_exec_images_recommend`: deterministic route selection for provider,
  model, surface profile, dimensions, and quality.
- `bakin_exec_images_generate`: generates through a runtime image provider or
  native direct adapter and saves the result into Assets with generation
  metadata. Accepts `referenceImages` (#418) — managed assetIds and/or local
  file paths (mix freely, max 4) that condition the generation. A
  reference-bearing generate is a NEW asset (use `_edit` to revise an existing
  one in place).
- `bakin_exec_images_edit`: edits a managed asset (new version on the same
  asset); `referenceImages` supplies extra context images alongside the base.
- `bakin_exec_images_import`: imports a local image file into Assets.
- `bakin_exec_images_export`: creates resized/cropped/format-converted variants
  for a target surface profile.
- `bakin_exec_images_profiles`: lists platform surface profiles and provider
  readiness.

## Providers And Auth

Runtime routes:

- OpenClaw implements `ctx.runtime.images` with `openclaw infer image
  providers|generate|edit --json`.
- OpenClaw-owned auth, including OpenAI Codex OAuth, stays inside OpenClaw.
  The images plugin never reads OpenClaw home files or extracts tokens.
- Runtime providers discovered from OpenClaw can include OpenAI, Google,
  OpenRouter, LiteLLM, DeepInfra, fal, ComfyUI, MiniMax, Vydra, and xAI.

Direct shim (gap-fill, owned by the runtime adapter, not the plugin):

- Lives in `@bakin/core/media/direct-image-provider` and is composed by the
  OpenClaw adapter's `images.generate` when OpenClaw can't serve the route.
- Direct providers: OpenAI (`gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`,
  `gpt-image-1-mini`) and Google Gemini (`gemini-3.1-flash-image-preview`,
  `gemini-3-pro-image-preview`).
- Shim credentials are Bakin-owned secrets — env vars (`OPENAI_API_KEY`,
  `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY`) in Phase 1, resolved at the adapter.
  The plugin never reads runtime config for keys.

Serving-path diagnostics ("how"): generation results carry
`routeSource` (`runtime` | `shim`) + `credentialSource`; provider readiness and
`recommend` report a provider-level `servedBy` prediction
(`runtime` | `shim` | `unconfigured`).

Provider support is adapter-based, not raw generic HTTP. Add new providers by
adding a runtime adapter provider route, or (for the direct shim) a provider
entry in the shared module plus route tests and generation metadata coverage.

## Reference images, quality, and capability gating (#418 / #379)

- **Reference images** are resolved at the Bakin layer: assetIds → current
  version via `ctx.assets.resolveVersionFile`; raw paths are auto-imported into
  Assets (source-path dedup) so every reference becomes a tracked asset. Cap is
  `MAX_REFERENCE_IMAGES = 4`. Native `infer image generate` has no file input, so
  reference generates are routed through `infer image edit --file …`; edit
  appends references after the base. Lineage is stamped into
  `generation.references` (`assetId@version`) and folds into the idempotency key
  so same-prompt/different-refs is not a duplicate.
- **Native-only**: references require the runtime path. If the route resolves to
  the direct shim (`servedBy: 'shim'`), the call fails loudly **before billing** —
  the shim has no image-input path.
- **Capability gate**: the selected model must declare the `reference-images`
  capability (read from the curated static descriptor, which is preferred over
  runtime-synthesized capabilities — those would clobber the static flag; see
  #381). A model without it fails loudly before billing.
- **Quality** is a shim-only concept — OpenClaw's CLI has no quality flag. The
  asset sidecar records `generation.quality` only on the shim path; native
  generations omit it. The shim rejects (pre-billing) any option it can't honor
  (`count>1`, `aspectRatio`, `resolution`, `background`, non-png format).
- **Asset discovery**: `bakin_exec_assets_list` takes an optional `tags` filter
  (AND semantics) — the agent's clean way to "look in a folder" (folders = tags).

## Workflows And Skills

`images` ships the primitive `image-generation` workflow. It uses
`$preferred(pixel,$assigned)` so Pixel gets the step when installed, with a
fallback to the assigned agent. Composite workflows such as social posts should
depend on `workflow_id: image-generation` instead of owning image generation
logic themselves.

Runtime skills shipped by the plugin:

- `create-image`
- `create-image-openai`
- `create-image-gemini`
- `image-model-routing`
- `image-qc`

The approval-gated workflow saves a prompt packet asset via
`savePromptPacket: true`; normal direct tool calls save structured generation
metadata plus a prompt hash in the sidecar.
