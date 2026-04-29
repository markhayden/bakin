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
3. Publish to each configured runtime channel
4. Record the post URLs for tracking

## Runtime Channel Notes

- Use `bakin_exec_post_channel` for delivery.
- Preserve attachments as explicit files instead of embedding provider-specific URLs.
- Adapt formatting only when the task or runtime channel name makes a platform requirement explicit.

## Verification

After publishing, verify each post is live and accessible.
