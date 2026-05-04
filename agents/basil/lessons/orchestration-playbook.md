---
title: Orchestration Playbook
tags: [orchestration, pipeline, basil]
defaultEnabled: false
---

# Orchestration Playbook

Basil is the most-orchestrating content agent — daily posts that almost always need image OR video assets from Pixel and Rolo. This is how to brief them well so the round-trip is fast and the assets land right the first time.

## The brief structure

A bad brief gets a bad asset back. A specific brief gets a specific asset. The shape that works:

```
Style: <photorealistic | cartoon | infographic | flat lay | editorial illustration | ...>
Subject: <what's in the frame, with adjectives>
Composition: <hero shot | top-down | candid | studio>
Lighting: <natural / golden hour / studio softbox / etc.>
Mood: <warm and inviting | crisp and clinical | rustic | minimal>
Aspect ratio: <16:9 | 9:16 | 1:1 — depends on platform>
Reference: <link or "no specific reference, freestyle">
What to avoid: <one specific anti-pattern, e.g. "no faces" or "not stock-photo glossy">
```

The "what to avoid" is the single most underused field. Pixel and Rolo do better when they know one specific thing NOT to do.

## When to use Pixel vs Rolo

| Need                              | Pixel | Rolo |
|-----------------------------------|-------|------|
| Hero shot of the dish              | ✓     |      |
| Recipe card / infographic          | ✓     |      |
| Ingredient flat-lay                | ✓     |      |
| Brand-style food photography       | ✓     |      |
| Recipe walkthrough video (any length) |    | ✓     |
| Quick-tip 15-second clip           |       | ✓     |
| Audio-driven content (no visuals)  |       | ✓ (audio path) |
| "B-roll" food prep clips           |       | ✓     |

When in doubt: still image = Pixel, motion = Rolo.

## Pipeline patterns

### Single-asset post (most common)

1. Write caption + brief
2. Dispatch Pixel with full brief
3. Set dependency, exit
4. On re-dispatch: review the asset
5. If acceptable: assemble package, hand to Roscoe
6. If not: dispatch Pixel again with revision instructions (be specific about what to change)

### Multi-asset post (e.g. recipe with hero + step shots)

1. Write the full caption
2. Brief Pixel with ALL needed shots in ONE task — describe each shot with its own micro-brief
3. Set dependency, exit
4. On re-dispatch: assemble the post in the right order
5. Hand to Roscoe

### Recipe video post

1. Write the caption + recipe steps
2. Dispatch Rolo with the recipe steps + desired video format (vertical for IG, square for Twitter, etc.)
3. Rolo internally coordinates with Pixel for any still images needed (cover frame, etc.)
4. Set dependency, exit
5. On re-dispatch: assemble package

## Common briefing mistakes

- **"Make it look nice"** — meaningless. Specify which "nice" — editorial, commercial, rustic, minimal. The model handles named-style requests better than vibe descriptions.
- **No anti-pattern in the brief** — Pixel will guess. The guess is often wrong on first generation. Naming what to avoid cuts the iteration count.
- **"For social media"** without specifying platform — Instagram, TikTok, Pinterest, LinkedIn all want different aspect ratios + different aesthetics. Specify.
- **Forgetting the audience** — "for someone who's never made this before" produces a friendlier shot than "for an established food enthusiast." Mention who the post is FOR.
- **Reusing yesterday's brief** — easy to copy-paste an old brief and forget to update specifics. Recipe-of-the-day deserves a fresh, specific brief.

## Revision etiquette

When asking for a revision, edit the original brief — don't write a new one with just the diff. Pixel's iteration logic works better when the WHOLE brief is up-to-date than when you're sending "actually do X instead of Y."

Format:
```
REVISION: <one-line summary of what changed>

<full updated brief, with the change applied>
```

Keep revisions to one round if possible. If the third generation still isn't right, the brief is the problem — not Pixel's execution.

## Roscoe handoff

When the post is fully assembled, the hand-off to Roscoe should include:
- Final caption (with hashtags, mentions, links)
- Asset paths (all images + video)
- Suggested platform(s)
- Suggested posting time (if time-sensitive)
- Notes on cross-posting / variations needed

Roscoe schedules and publishes; Basil's job ends at "complete post package ready."
