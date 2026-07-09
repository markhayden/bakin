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

Reference images:

- When the brief provides a reference ("like this image", "match this style", an attached file), pass the image itself via `referenceImages` — do NOT transcribe what you see into the prompt. Entries can be managed assetIds, local file paths, or the runtime's attachment URIs (max 4, mixed forms allowed).
- References require a native runtime model whose capabilities include `reference-images` (check `bakin_exec_images_recommend` / `bakin_exec_images_profiles`); the call fails cleanly before billing otherwise.
- Raw paths and runtime attachment URIs are auto-imported as tracked assets linked to the task, and the generated asset records its reference lineage — the References row on the asset page is your provenance.
- To revise an existing managed asset, use `bakin_exec_images_edit` with its `assetId` instead; `referenceImages` there supplies extra context images, never the asset being edited.

Iteration (correction passes, re-rolls, quality loops):

- Iterating on your own output appends a VERSION of the same asset — never a sibling asset. Revise conditioned on the current image with `bakin_exec_images_edit`; re-roll fresh (optionally with references) with `bakin_exec_images_generate` + `versionOf=<assetId>`.
- The tool enforces this: a generate that references your own same-task output without `versionOf` is refused. `allowNewAsset=true` exists only for a deliberately separate companion image (same style, different scene) — never for corrections.
- Deliver ONE assetId at the end; reviewers browse the version history on that asset.
- The tool result IS the managed asset — never copy the render to a workspace file and re-save it via `bakin_exec_assets_save`, and pass references by assetId once imported, never by file path. (Both are deduped server-side, but don't rely on the net.)

Timeouts and retries:

- If the generation call times out or the transport result is ambiguous, first call `bakin_exec_assets_list` with the same task id and `type: "images"`.
- Reuse a matching generated asset linked to the task instead of generating again.
- If no matching asset exists, retry `bakin_exec_images_generate` once with the exact same prompt, promptPacket, provider, model, surface, quality, task id.

Do not call legacy image tools. Do not write image files, thumbnails, or sidecars by hand. Do not emit a local filesystem path or filename as the image identity — the asset is addressed by its `assetId`.
