# Create Image

Use this skill to create a production image through Bakin's core images plugin.

## Inputs

- `taskId`: required task id for asset linkage
- `brief`: creative brief
- `surface`: optional surface profile
- `objective`: optional business/creative objective
- `quality`: optional quality tier
- `usageConstraints`: approval, brand, legal, text, and platform constraints

## Procedure

1. Build a provider-neutral prompt packet with subject, audience/use, surface, composition, lighting, style, color/material cues, required text, exclusions, brand-safety constraints, and accessibility notes.
2. Call `bakin_exec_images_recommend` to select the provider, model, surface, dimensions, and quality tier.
3. If human approval is required by the workflow or user, present the prompt packet, route, and usage constraints before generation.
4. Call `bakin_exec_images_generate` with `taskId`, `promptPacket`, `prompt`, `provider`, `model`, `surface`, `quality`, and `savePromptPacket: true` for approval-gated work.
5. Return the canonical `image_filename` from the tool. Do not return a local path as the image identity.

## Prompt Rules

- Front-load the exact visual subject and intended use.
- Use surface profile ids for dimensions instead of raw aspect-ratio prose.
- Keep brand, legal, and text constraints explicit.
- Avoid provider-specific slang unless a provider-specific skill is being used.
