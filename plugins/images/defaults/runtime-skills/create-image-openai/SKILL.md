# Create Image With OpenAI

Use this skill when the image should be generated through an OpenAI image route.
The images plugin prefers the runtime route first, so OpenClaw Codex OAuth can
be used without exposing OpenClaw tokens to Bakin.

## Inputs

- `taskId`: required task id for asset linkage
- `brief`: creative brief
- `surface`: optional surface profile
- `model`: optional OpenAI model, defaulting through routing. Prefer
  `gpt-image-2` unless the request specifically needs another configured
  OpenAI image model.
- `quality`: optional quality tier

## Procedure

1. Build a provider-neutral prompt packet. Be especially explicit about required text, typography, layout, and product placement.
2. Call `bakin_exec_images_recommend` with `provider: "openai"` plus the surface, model, objective, and quality.
3. Confirm the returned route uses provider `openai`.
4. Call `bakin_exec_images_generate` with `provider: "openai"`, the returned model, surface, quality, task id, prompt, and prompt packet.
5. Return `assetId`, provider, model, surface, width, height, and promptHash.

Do not call the OpenAI API directly. The images plugin owns runtime/native
routing, authentication lookup, asset save, and generation metadata.
