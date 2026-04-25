# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- API keys (referenced by env-var name only — never paste secrets)
- Default Runway model + resolution
- Preferred ElevenLabs voice IDs
- Per-install workspace paths
- Anything environment-specific

## Examples

```markdown
### Video generation

- Runway: $RUNWAY_API_KEY (Gen-4 default)
- Default resolution: 1280x768 (16:9) or 768x1280 (9:16 for vertical)

### Audio

- ElevenLabs: $ELEVENLABS_API_KEY
- Default voice id (warm + neutral): 21m00Tcm4TlvDq8ikWAM
- Music style anchor: "warm jazzy commercial" — adjust per brief
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
