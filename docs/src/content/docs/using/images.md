---
title: Images
description: Provider-routed image generation, imports, exports, and platform surface profiles.
---

The Images plugin is Bakin's core image-generation layer. It routes requests to
the active runtime image adapter first, then falls back to configured direct
provider adapters when the runtime does not expose that route. Outputs are
always saved through Assets and returned as canonical asset filenames for
downstream workflows.

Use the recommendation tool before generation when the brief does not already
pin a provider, model, surface, and quality tier. The generator persists
provider/model/surface metadata in the asset sidecar. Approval-gated workflows
can also save the full prompt packet as a linked text asset.

With the default OpenClaw runtime adapter, image generation uses
`openclaw infer image ...` under the hood. That means OpenClaw-owned auth,
including OpenAI Codex OAuth, stays inside OpenClaw. Bakin does not read
OpenClaw auth files or extract runtime tokens. Direct `OPENAI_API_KEY`,
`GEMINI_API_KEY`, and `GOOGLE_AI_API_KEY` environment variables remain
supported as fallback native routes.

## Core Flow

1. Build a prompt packet from the creative brief.
2. Call `bakin_exec_images_recommend` with the target surface and objective.
3. Get approval for the prompt packet, model route, platform surface, and usage
   constraints when the workflow requires it.
4. Call `bakin_exec_images_generate`.
5. Pass the returned `image_filename` to publishing or review tools.

## Providers

Runtime providers are discovered from `ctx.runtime.images.providers()` when the
active runtime supports image generation. OpenClaw currently exposes providers
such as OpenAI, Google, OpenRouter, LiteLLM, DeepInfra, fal, ComfyUI, MiniMax,
Vydra, and xAI when they are configured there.

The built-in direct fallback adapters cover:

- OpenAI: `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`
- Google Gemini: `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`

Use `provider/model` routes for runtime-specific providers, such as
`openrouter/google/gemini-3.1-flash-image-preview`. Use unqualified model ids
only for the built-in OpenAI and Google routes.

## Tools

<!-- docs:exec-tools images -->
- `bakin_exec_images_edit`: Edit an existing image (managed asset or local file) through the runtime image provider with edit instructions, save the result into Assets, and return the canonical image filename.
- `bakin_exec_images_export`: Export an existing image asset to a target surface profile by resizing, cropping, and format-converting it.
- `bakin_exec_images_generate`: Generate an image through a configured runtime image provider or native image provider adapter, save it into Assets, and return the canonical image filename.
- `bakin_exec_images_import`: Import an existing local image file into the Assets pipeline and return the canonical image filename.
- `bakin_exec_images_profiles`: List image surface profiles and configured provider readiness. Use this before choosing dimensions or provider routes for image generation.
- `bakin_exec_images_recommend`: Recommend a deterministic image provider, model, surface profile, dimensions, and quality tier for an image generation request.
<!-- /docs:exec-tools -->

Full schemas and arguments are in the [Exec tools reference](/docs/reference/generated/exec-tools/).
