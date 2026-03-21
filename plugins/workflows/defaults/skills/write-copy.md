---
name: Write Copy
output_schema:
  type: object
  required:
    - caption
    - body
    - hashtags
  properties:
    caption:
      type: string
      maxLength: 280
    body:
      type: string
    hashtags:
      type: array
      items:
        type: string
---

## Instructions

Write social media copy for a content post. Include:
- A caption (max 280 characters) — punchy, on-brand
- A longer body section with the recipe, tip, or story
- 3-5 relevant hashtags

## Tone

Match the brand voice in existing published posts.

## Examples

**Good caption:** "Sunday mornings call for sourdough..."
**Bad caption:** "Check out this bread recipe!!!"
