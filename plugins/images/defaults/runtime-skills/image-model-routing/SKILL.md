# Image Model Routing

Use this skill when deciding which image provider, model, surface profile, and quality tier should be used.

## Inputs

- `brief`: creative brief or user request
- `surface`: optional platform/profile target
- `objective`: business or creative goal, such as CTR, typography, brand photo, blog hero, or social carousel
- `provider`: optional forced provider (`auto`, `openai`, or `google`)
- `model`: optional forced model
- `quality`: optional quality tier (`draft`, `standard`, or `premium`)

## Procedure

1. Extract the intended platform, aspect, usage constraints, visible text needs, brand constraints, and required output quality.
2. Call `bakin_exec_images_recommend` with the extracted `surface`, `objective`, `provider`, `model`, and `quality`.
3. Use the returned `provider`, `model`, `surface`, `width`, `height`, and `quality` exactly unless the user explicitly changes the constraints.
4. If the recommendation says credentials are missing, report the missing provider route and do not invent a raw provider call.

## Output

Return a compact route object:

```json
{
  "provider": "openai",
  "model": "gpt-image-2",
  "surface": "instagram-feed-portrait",
  "width": 1080,
  "height": 1350,
  "quality": "standard",
  "reason": "Short rationale"
}
```
