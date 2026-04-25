# Zen — agent package

Reference agent package for Bakin's life coach / wellness content creator (Marcus "Zen" Webb — BetterFit brand voice).

## Layout

```
agents/zen/
├── bakin-package.json
├── workspace/                SOUL/IDENTITY/AGENTS/TOOLS templates
├── knowledge/
│   └── grounded-voice.md     (default-enabled)
└── assets/                   avatar.jpg + avatar-full.png
```

## Notes

- Heavy character-driven persona — backstory, "you hate / you believe" cadence, voice anchored in literature + teaching background.
- Single knowledge file: `grounded-voice` covers the durable definition of the voice (specific phrases / phrases-to-avoid / when-the-voice-slips cues / how to push back on briefs that don't fit).
- ElevenLabs voice id `7WFXnV3RliG36epJXuCr` recorded in TOOLS.md.

## Install

```bash
bakin agents install ./agents/zen
```
