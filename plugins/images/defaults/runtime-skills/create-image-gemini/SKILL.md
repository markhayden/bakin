# Create Image With Gemini

Use this skill when the image should be generated through a Google Gemini image route.
The images plugin prefers configured runtime routes first, then falls back to
the direct Gemini adapter when a direct API key is configured.

## Inputs

- `taskId`: required task id for asset linkage
- `brief`: creative brief
- `surface`: optional surface profile
- `model`: optional Gemini image model, defaulting through routing. Prefer
  `gemini-3.1-flash-image-preview` for general work and
  `gemini-3-pro-image-preview` for premium routes when configured.
- `quality`: optional quality tier

## Procedure

1. Build a provider-neutral prompt packet with concrete subject, style, lighting, camera/composition, and visual constraints.
2. Call `bakin_exec_images_recommend` with `provider: "google"` plus the surface, model, objective, and quality.
3. Confirm the returned route uses provider `google`.
4. Call `bakin_exec_images_generate` with `provider: "google"`, the returned model, surface, quality, task id, prompt, and prompt packet.
5. Return `assetId`, provider, model, surface, width, height, and promptHash.

## Retry Discipline

- If the generate call times out or the transport result is ambiguous, do not change the prompt, route, surface, model, quality, or task id.
- Before retrying, call `bakin_exec_assets_list` with the same `taskId` and `type: "images"` and reuse any matching generated asset for that task.
- If no matching asset exists, retry `bakin_exec_images_generate` once with the exact same parameters. Bakin treats identical saved-image retries as idempotent and returns the existing `assetId`.

Do not call Gemini directly. The images plugin owns runtime/native routing,
authentication lookup, asset save, and generation metadata.
