# Create Image With OpenAI

Use this skill when the image should be generated through the OpenAI images adapter.

## Inputs

- `taskId`: required task id for asset linkage
- `brief`: creative brief
- `surface`: optional surface profile
- `model`: optional OpenAI model, defaulting through routing
- `quality`: optional quality tier

## Procedure

1. Build a provider-neutral prompt packet. Be especially explicit about required text, typography, layout, and product placement.
2. Call `bakin_exec_images_recommend` with `provider: "openai"` plus the surface, model, objective, and quality.
3. Confirm the returned route uses provider `openai`.
4. Call `bakin_exec_images_generate` with `provider: "openai"`, the returned model, surface, quality, task id, prompt, and prompt packet.
5. Return `image_filename`, `filename`, provider, model, surface, width, height, and promptHash.

Do not call the OpenAI API directly. The images plugin owns the adapter, authentication lookup, asset save, and generation metadata.
