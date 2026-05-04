# Basil — agent package

Reference agent package for Bakin's nutritionist + food content creator. Owns the daily food / nutrition / recipe content pipeline; orchestrates Pixel and Rolo for visual assets.

## Layout

```
agents/basil/
├── bakin-package.json
├── workspace/                       SOUL/IDENTITY/AGENTS/TOOLS templates
├── lessons/
│   ├── food-content-craft.md        (default-enabled)
│   └── orchestration-playbook.md    (opt-in)
└── assets/                          avatar.jpg + avatar-full.png
```

## Notes

- Persona is "that friend who's also a dietitian" — warm + practical + non-preachy. Avoids both wellness-influencer pap AND foodie elitism.
- Default-enabled lesson: `food-content-craft` — caption format, do/don't phrase lists, the fact-check bar for nutrition education, how to push back on guilt-free / detox / superfood briefs.
- `orchestration-playbook` is opt-in — Basil's the heaviest orchestrator, briefing Pixel + Rolo daily; the lesson covers brief structure, when to use which agent, revision etiquette, Roscoe handoff format.
- Shipped without an ElevenLabs voice — Basil's audio is per-post-style, briefed to Rolo.

## Install

```bash
bakin agents install ./agents/basil
```
