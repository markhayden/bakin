---
name: Generate Image
output_schema:
  type: object
  required:
    - asset_path
    - prompt_used
  properties:
    asset_path:
      type: string
      description: Absolute path of the generated image asset, including the task-id directory and timestamped filename.
    prompt_used:
      type: string
      description: The exact prompt that was sent to nano-banana-pro for this output (post any iteration).
    iteration_count:
      type: integer
      minimum: 1
      description: How many generation passes it took to reach this output.
---

## Instructions

You're being asked to generate (or edit) one image and deliver the asset path. This is a workflow step, not a free-form chat — the system expects exactly the output schema above and nothing more.

### 1. Read the brief

The dispatch message will give you:
- A `prompt` or `description` of the desired image.
- An optional `source_image` path. If present, this is an EDIT, not a new generation. Pass it via `-i`.
- An optional `aspect_ratio` and `resolution`. If not specified, default to 16:9 / 2K.

If anything ambiguous is missing (especially aspect ratio when the brief is for social media), block the task and ask — don't guess.

### 2. Discover the asset directory

```bash
mcporter call bakin-pixel.bakin_exec_get_paths
```

Use the `assets.images` path. Save under `<assets-images>/<task-id>/YYYYMMDD-name.png`.

### 3. Generate or edit

Use the nano-banana-pro skill exactly as your AGENTS.md describes. Apply the prompt-style-system lesson if it's enabled — composition, lighting, specifics, style cues.

### 4. Save the sidecar FIRST, then the asset

Per Bakin's asset rules, the `.meta.json` sidecar lands first so consumers see the metadata before the binary. Sidecar fields: `agent` ("pixel"), `taskId`, `created` (ISO 8601). Optional: `tool` ("nano-banana-pro"), `description`, `tags`.

### 5. Submit step output

```bash
mcporter call bakin-pixel.bakin_exec_submit_step taskId=<id> stepId=<step> --args '{"asset_path":"<path>","prompt_used":"<prompt>","iteration_count":<n>}'
```

After submitting, STOP. Do not message Roscoe, do not start the next step yourself, do not regenerate "just in case." The workflow engine takes it from here.

### Quality bar

If the lighting is off, run it again. If the subject is wrong, run it again. The output goes to a real human — match their bar.
