---
name: Generate Video
output_schema:
  type: object
  required:
    - video_filename
  properties:
    video_filename:
      type: string
      description: "Globally-unique asset filename (e.g., 20260401-reel-a1b2c3d4.mp4). Stable identity across retype/relink — do NOT emit a directory path."
    duration_seconds:
      type: number
    thumbnail_filename:
      type: string
      description: "Filename of the generated thumbnail variant, if any."
---

## Instructions

Generate a short-form video clip for the content post.

1. Read the copy brief from the previous step's output
2. Create a video concept that complements the written content
3. Generate or compose the video using available tools
4. Keep it short: 15-60 seconds for social media
5. Save to the assets directory — the save tool returns the `filename` field; emit that (not the full path)

## Format Requirements

- Vertical (9:16) for stories/reels, or square (1:1) for feed
- Include captions/text overlay if appropriate
- Smooth transitions, no jarring cuts
