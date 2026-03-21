---
name: Generate Video
output_schema:
  type: object
  required:
    - video_path
  properties:
    video_path:
      type: string
    duration_seconds:
      type: number
    thumbnail_path:
      type: string
---

## Instructions

Generate a short-form video clip for the content post.

1. Read the copy brief from the previous step's output
2. Create a video concept that complements the written content
3. Generate or compose the video using available tools
4. Keep it short: 15-60 seconds for social media
5. Save to the assets directory

## Format Requirements

- Vertical (9:16) for stories/reels, or square (1:1) for feed
- Include captions/text overlay if appropriate
- Smooth transitions, no jarring cuts
