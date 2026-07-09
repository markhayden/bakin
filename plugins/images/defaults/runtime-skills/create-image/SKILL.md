# Create Image

Use this skill to create a production image through Bakin's core images plugin.
The plugin routes through the runtime image adapter first when available, then
falls back to direct native provider adapters for configured OpenAI or Gemini
API keys.

## Inputs

- `taskId`: required task id for asset linkage
- `brief`: creative brief
- `surface`: optional surface profile
- `objective`: optional business/creative objective
- `quality`: optional quality tier
- `usageConstraints`: approval, brand, legal, text, and platform constraints

## Procedure

1. Build a provider-neutral prompt packet with subject, audience/use, surface, composition, lighting, style, color/material cues, required text, exclusions, brand-safety constraints, and accessibility notes.
2. Call `bakin_exec_images_recommend` to select the provider, model, surface, dimensions, and quality tier. Runtime providers returned by the tool are valid routes.
3. If human approval is required by the workflow or user, present the prompt packet, route, and usage constraints before generation.
4. Call `bakin_exec_images_generate` with `taskId`, `promptPacket`, `prompt`, `provider`, `model`, `surface`, and `quality`.
5. Return the `assetId` from the tool. Do not return a local path or filename as the image identity.

## Retry Discipline

- If the generate call times out or the transport result is ambiguous, do not change the prompt, route, surface, model, quality, or task id.
- Before retrying, call `bakin_exec_assets_list` with the same `taskId` and `type: "images"` and reuse any matching generated asset for that task.
- If no matching asset exists, retry `bakin_exec_images_generate` once with the exact same parameters. Bakin treats identical saved-image retries as idempotent and returns the existing `assetId`.

## Prompt Rules

- Front-load the exact visual subject and intended use.
- Use surface profile ids for dimensions instead of raw aspect-ratio prose.
- Keep brand, legal, and text constraints explicit.
- Branded task? Pass `brandId` to the generate/edit tool — the brand's palette and identity merge into the prompt and its default reference images (real product screenshots, logos) attach automatically. Never hand-copy hex codes when a brandId exists.
- Avoid provider-specific slang unless a provider-specific skill is being used.
