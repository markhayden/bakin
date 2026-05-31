# Image QC

Use this skill to review generated or imported image assets before they are approved for use.

## Inputs

- `assetId`: managed image asset id
- `brief`: original creative brief
- `surface`: intended platform/profile
- `usageConstraints`: brand, legal, text, and accessibility constraints

## Checklist

1. Confirm the asset is referenced by `assetId`, not a filesystem path or filename.
2. Check the asset metadata for provider, model, surface, width, height, quality, and promptHash when available.
3. Compare the visible image against the brief: subject, composition, lighting, style, mood, required text, and exclusions.
4. Check the platform fit: dimensions, crop risk, safe zones, legibility, and expected format.
5. Check brand/legal fit: no disallowed marks, sensitive claims, unsupported product promises, or unsafe likeness usage.
6. Write concise approval notes or concrete rejection notes.

## Output

Return:

```json
{
  "approved": true,
  "assetId": "20260401-blog-hero-a1b2c3d4",
  "surface": "instagram-feed-portrait",
  "notes": "Concise review result"
}
```
