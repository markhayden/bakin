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

## Style Guidelines

- Clean, modern aesthetic
- Natural lighting preferred
- On-brand color palette
- Minimum 1080x1080 for social media
