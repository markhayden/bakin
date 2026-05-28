# Images Plugin

Core plugin id: `images`.

The images plugin owns provider-routed image generation primitives. It prefers
the active runtime adapter's `ctx.runtime.images` capability and falls back to
native direct adapters only when the runtime route is not configured. Generated
and imported files are persisted through the Assets plugin, so downstream
workflows should pass canonical asset filenames such as `image_filename`, not
local filesystem paths.

## Tools

- `bakin_exec_images_recommend`: deterministic route selection for provider,
  model, surface profile, dimensions, and quality.
- `bakin_exec_images_generate`: generates through a runtime image provider or
  native direct adapter and saves the result into Assets with generation
  metadata.
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

Native direct fallback adapters:

- OpenAI: `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`
- Google Gemini: `gemini-3.1-flash-image-preview`,
  `gemini-3-pro-image-preview`

Provider support is adapter-based, not raw generic HTTP. Add new providers by
adding a runtime adapter provider route or a native descriptor, credentials
lookup, adapter implementation, route tests, and generation metadata coverage.

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
