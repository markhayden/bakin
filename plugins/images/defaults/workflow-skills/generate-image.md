---
output_schema:
  type: object
  required:
    - assetId
    - provider
    - model
    - surface
  properties:
    assetId:
      type: string
      description: "Managed image asset id returned by the tool (e.g. 20260401-blog-hero-a1b2c3d4). Not a filename or directory path."
    version:
      type: number
      description: "Asset version produced (1 for a fresh generate)."
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
---

## Instructions

Generate the approved image through the images plugin. The plugin owns
runtime/native routing, provider authentication, and saving the result as a
managed versioned asset.

1. Read the approved prompt, promptPacket, route, surface, and quality from priorStepOutput.
2. Call `bakin_exec_images_generate` with the current task id, `promptPacket`, `prompt`, `provider`, `model`, `surface`, and `quality`.
3. Verify the tool returned `ok: true`.
4. Submit the tool's returned `assetId`, `version`, provider, model, surface, width, height, and promptHash.

Do not call legacy image tools. Do not write image files, thumbnails, or sidecars by hand. Do not emit a local filesystem path or filename as the image identity — the asset is addressed by its `assetId`.
