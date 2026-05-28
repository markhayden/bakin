---
title: Images
description: Provider-routed image generation, imports, exports, and platform surface profiles.
---

The Images plugin is Bakin's core image-generation layer. It routes requests to
configured native provider adapters, saves outputs through Assets, and returns a
canonical asset filename for downstream workflows.

Use the recommendation tool before generation when the brief does not already
pin a provider, model, surface, and quality tier. The generator persists
provider/model/surface metadata in the asset sidecar. Approval-gated workflows
can also save the full prompt packet as a linked text asset.

## Core Flow

1. Build a prompt packet from the creative brief.
2. Call `bakin_exec_images_recommend` with the target surface and objective.
3. Get approval for the prompt packet, model route, platform surface, and usage
   constraints when the workflow requires it.
4. Call `bakin_exec_images_generate`.
5. Pass the returned `image_filename` to publishing or review tools.

## Tools

<!-- docs:exec-tools images -->
- `bakin_exec_images_export`: Export an existing image asset to a target surface profile by resizing, cropping, and format-converting it.
- `bakin_exec_images_generate`: Generate an image through a configured native image provider adapter, save it into Assets, and return the canonical image filename.
- `bakin_exec_images_import`: Import an existing local image file into the Assets pipeline and return the canonical image filename.
- `bakin_exec_images_profiles`: List image surface profiles and configured provider readiness. Use this before choosing dimensions or provider routes for image generation.
- `bakin_exec_images_recommend`: Recommend a deterministic image provider, model, surface profile, dimensions, and quality tier for an image generation request.
<!-- /docs:exec-tools -->

Full schemas and arguments are in the [Exec tools reference](/docs/reference/generated/exec-tools/).
