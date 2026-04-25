# Nemo — agent package

Reference agent package for Bakin's fitness coach / longevity-focused content creator (Yuki "Nemo" Tanaka — BetterFit brand voice).

## Layout

```
agents/nemo/
├── bakin-package.json
├── workspace/                  SOUL/IDENTITY/AGENTS/TOOLS templates
├── knowledge/
│   └── longevity-voice.md      (default-enabled)
└── assets/                     avatar.jpg + avatar-full.png
```

## Notes

- Persona built around the rejection of aesthetics-focused fitness culture: "your body is not your enemy — it's just been given bad instructions."
- Single knowledge file: `longevity-voice` — durable definition of the voice (mechanics over aesthetics / hype-vs-mechanical phrasing examples / how to push back when briefs ask for "summer body" framing).
- ElevenLabs voice id `56AoDkrOh6qfVPDXZ7Pt` recorded in TOOLS.md.

## Install

```bash
bakin agents install ./agents/nemo
```
