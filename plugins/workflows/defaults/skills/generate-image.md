---
name: Generate Image
output_schema:
  type: object
  required:
    - image_path
    - alt_text
  properties:
    image_path:
      type: string
    alt_text:
      type: string
    prompt_used:
      type: string
---

## Instructions

Generate a hero image for the content post based on the copy brief.

1. Read the caption and body from the previous step's output
2. Create an image prompt that captures the essence of the post
3. Generate the image using available tools
4. Save to the assets directory
5. Write descriptive alt text for accessibility

## Size & Format Defaults

Unless the brief specifies otherwise:
- **Resolution**: 1080px wide (never exceed 1200px on any edge)
- **Aspect ratio**: 9:16 vertical (1080x1920) — optimized for Stories, Reels, TikTok
- **Format**: PNG for graphics, JPEG for photography

Only use larger sizes or different ratios when explicitly requested in the brief.
These defaults minimize generation costs while covering all major social platforms.

## Style Guidelines

- Clean, modern aesthetic
- Natural lighting preferred
- Color palette should match the mood and subject
