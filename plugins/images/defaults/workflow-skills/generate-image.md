---
output_schema:
  type: object
  required:
    - image_filename
    - filename
    - provider
    - model
    - surface
  properties:
    image_filename:
      type: string
      description: "Canonical generated image asset filename. Do not emit a directory path."
    filename:
      type: string
      description: "Same canonical generated image asset filename."
    provider:
      type: string
    model:
      type: string
    surface:
      type: string
    width:
      type: number
    height:
      type: number
    promptHash:
      type: string
    promptAssetFilename:
      type: string
---

## Instructions

Generate the approved image through the images plugin. The plugin owns
runtime/native routing, provider authentication, asset saving, and sidecar
metadata.

1. Read the approved prompt, promptPacket, route, surface, and quality from priorStepOutput.
2. Call `bakin_exec_images_generate` with the current task id, `promptPacket`, `prompt`, `provider`, `model`, `surface`, `quality`, and `savePromptPacket: true` when the workflow has an approval gate.
3. Verify the tool returned `ok: true`.
4. Submit the tool's returned `image_filename`, `filename`, provider, model, surface, width, height, promptHash, and promptAssetFilename.

Do not call legacy image tools. Do not write image files, thumbnails, or sidecars by hand. Do not emit a local filesystem path as the image identity.
