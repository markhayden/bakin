# Rolo — agent package

Reference agent package for Bakin's video producer.

## Layout

```
agents/rolo/
├── bakin-package.json
├── workspace/                 template files (SOUL/IDENTITY/AGENTS/TOOLS)
├── lessons/                 lessons w/ frontmatter
│   ├── video-pacing.md        (default-enabled)
│   └── audio-craft.md         (opt-in)
└── assets/                    avatar.jpg + avatar-full.png
```

## Notes

- Skills live in an external repo (`runway-skill`), not bundled here. Set `RUNWAY_API_KEY` and `ELEVENLABS_API_KEY` in the agent's workspace `.env` per-install.
- Default-enabled lesson: `video-pacing`. The `audio-craft` lesson is opt-in for tasks involving heavier audio work.
- Pairs naturally with the `pixel` package — Rolo dispatches to Pixel when stills are needed as video components.

## Install

```bash
bakin agents install ./agents/rolo
```
