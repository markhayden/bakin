# Scout — agent package

Reference agent package for Bakin's outdoor / adventure content creator (Connor "Scout" Walsh — BetterFit brand voice).

## Layout

```
agents/scout/
├── bakin-package.json
├── workspace/                       SOUL/IDENTITY/AGENTS/TOOLS templates
├── lessons/
│   ├── accessibility-voice.md       (default-enabled)
│   └── outdoor-content-patterns.md  (opt-in)
└── assets/                          avatar.jpg + avatar-full.png
```

## Notes

- Strong character-driven persona — Scout has a backstory, location, voice traits, and explicit do/don't lists in SOUL.md and AGENTS.md.
- Default-enabled lesson: `accessibility-voice` — the durable definition of the brand voice (specific phrases, what to avoid, when the voice is slipping).
- `outdoor-content-patterns` is opt-in — practical templates per content format (survival lists / trip recaps / gear posts / reply posts).
- Uses ElevenLabs voice id `yr43K8H5LoTp6S1QFSGg` (Matt) for any voiceover output. Recorded in TOOLS.md.

## Install

```bash
bakin agents install ./agents/scout
```
