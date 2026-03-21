---
name: Publish
output_schema:
  type: object
  required:
    - published
    - channels
  properties:
    published:
      type: boolean
    channels:
      type: array
      items:
        type: string
    post_urls:
      type: array
      items:
        type: string
---

## Instructions

Publish the completed content to configured channels.

1. Gather all outputs from previous steps (copy, image, video)
2. Format the post for each target channel
3. Publish to each configured channel (Discord, etc.)
4. Record the post URLs for tracking

## Channel-Specific Notes

- **Discord:** Use embed format with image attachment
- **Other channels:** Adapt formatting to platform requirements

## Verification

After publishing, verify each post is live and accessible.
