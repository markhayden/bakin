---
title: Visual Style System
tags: [core, style, aesthetics, prompting]
defaultEnabled: true
---

# Visual Style System

A taxonomy for picking and naming the right visual style. Briefs rarely state this explicitly — your job is to read between the lines and make the call.

## Core styles

### Photo-real
Indistinguishable from a real photograph. Real-world physics: accurate lens distortion, photorealistic skin pores, natural light falloff. Use for: product shots, editorial-style portraits, marketing photography.

**Prompt cues:** "shot on Sony A7R IV", "85mm f/1.4", "natural window light", "shallow depth of field", "photographic detail".

**Common failure:** drifting into "fashion magazine glossy" when the brief wanted documentary realism. Add "documentary photography" or "candid" to dial it back.

### Hyper-real
Photo-real but punchier — colors slightly more saturated, contrast slightly higher, every detail crisp in a way real cameras can't quite capture. Used in commercial work that wants to FEEL real but pop on a screen.

**Prompt cues:** "ultra-detailed", "hyperrealistic", "8K", "cinematic lighting", "high dynamic range".

**Common failure:** overshooting into "AI-art glossy plastic" — the giveaway is too-perfect skin and impossibly sharp eyelashes. Pull back with "natural skin texture, slight imperfections".

### Pixar 3D / stylized realism
Soft, warm, character-forward 3D rendering. Inspired but not copied from Pixar. Subjects have slightly exaggerated features, soft shadows, plush textures.

**Prompt cues:** "Pixar-style 3D animation", "subsurface scattering", "soft warm lighting", "character design", "expressive eyes". Avoid naming specific Pixar films — model handles named-IP requests inconsistently and there's brand-risk.

**Common failure:** pushing too cute when the brief wanted whimsical-but-grown-up. "Stylized 3D" without the Pixar reference often lands closer.

### Editorial illustration
Hand-drawn or hand-painted feel, conceptual rather than literal. The kind of art that runs alongside a New Yorker article. Subject often metaphorical.

**Prompt cues:** "editorial illustration", "gouache and ink", "muted palette", "conceptual", named illustrators (with caution — same IP-risk as named photographers).

**Common failure:** drifting into "stock illustration" — flat, generic, no perspective. Counter with "expressive brushwork" and a specific medium.

### Cinematic / film still
Looks like a frame from a movie. Specific aspect ratio (2.35:1 or 1.85:1), filmic color grade, motivated lighting. Use for hero images, narrative-heavy posts.

**Prompt cues:** "cinematic still", "anamorphic lens", "film grain", "Kodak Portra 400", "color graded".

**Common failure:** uniformly orange-and-teal because that's the AI's default film look. Specify the era or color grade — "1970s Kodak", "cool blue night-scene grade", "warm golden-hour summer film".

### Vector / flat / geometric
Clean shapes, limited palette, no gradients (or carefully restricted gradients). For icons, infographics, ui hero images.

**Prompt cues:** "flat vector illustration", "two-color", "geometric", "minimalist", specific aspect ratios.

**Common failure:** AI tends to add unnecessary detail. Add explicit constraints: "limited to 4 colors", "no gradients", "negative space prominent".

## Picking the right style

Read the brief for these signals:

| Brief language               | Probable target      |
|------------------------------|----------------------|
| "for our product page"       | photo-real           |
| "make it pop", "eye-catching"| hyper-real           |
| "fun", "approachable"        | Pixar 3D             |
| "thoughtful", "story"        | editorial illustration |
| "hero image", "campaign"     | cinematic            |
| "icon", "infographic"        | vector / flat        |

If the brief gives no signal, ask. Don't default to hyper-real — that's the AI's default and it makes everything look the same.

## Mixing styles

You can mix — but pick one anchor and use the other as accent. "Photo-real subject, editorial illustration background." "Pixar character, cinematic lighting." Two anchors fight each other and the model splits the difference badly.
