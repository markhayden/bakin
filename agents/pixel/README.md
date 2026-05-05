# Pixel — agent package

Reference agent package for Bakin's image artist. Used during the agent-packages refactor as the canonical first package — the manifest schema, installer, and projector were built against this real package, not a designed-from-scratch fixture.

## What's in the package

```
agents/pixel/
├── bakin-package.json        manifest (kind: "agent")
├── README.md                 this file
├── workspace/                template files seeded into the agent's OpenClaw workspace
│   ├── SOUL.md               persona, values, voice + lesson marker placeholders
│   ├── IDENTITY.md           structured identity card
│   ├── AGENTS.md             Pixel-specific operational rules (doctor injects bakin:* blocks on install)
│   └── TOOLS.md              boilerplate template for per-install local notes
├── lessons/                lessons — frontmatter declares title / tags / defaultEnabled
│   ├── prompt-style-system.md   (default-enabled)
│   ├── visual-styles.md         (default-enabled)
│   └── social-media-craft.md    (opt-in)
├── workflow-skills/          step instructions resolved by the workflows plugin
│   └── generate-image.md
└── assets/                   per-agent UI assets — projected to ~/.bakin/agents/pixel/
    ├── avatar.jpg
    └── avatar-full.png
```

## Notable choices

- **No bundled OpenClaw skill.** Pixel uses the OpenClaw built-in `nano-banana-pro` skill that ships with OpenClaw itself; she does not need to project a custom skill into her workspace.
- **AGENTS.md ships only Pixel-specific content.** The `bakin:mission-control`, `bakin:hard-rules`, `bakin:dependency-pattern`, `bakin:media-delegation`, `bakin:workflow-rules`, `bakin:asset-rules`, and `bakin:scheduling-rules` blocks are *not* in the package source — `bakin doctor` injects them on install and keeps them current as Bakin's defaults evolve.
- **Three lesson files**: two default-enabled (`prompt-style-system.md` covers prompt anatomy and iteration; `visual-styles.md` is the photo-real / hyper-real / Pixar-3D / editorial taxonomy) and one opt-in (`social-media-craft.md` covers viral patterns, click-bait without being slimy, and platform-specific aesthetics — only injected when the agent is doing social work). More lessons can be added later without a manifest change — drop a frontmatter'd `.md` in `lessons/` and bump the version.
- **`agent.allowedTools` and `allowedSkills`** are declarative documentation in V1. Once issue [#42](https://github.com/markhayden/bakin/issues/42) ships, the dispatch-routing layer will read these and enforce hard scoping at the MCP boundary.

## Installing

During development:
```bash
bakin agents install ./agents/pixel
```

Once the package lives in its own repo:
```bash
bakin agents install github:markhayden/bakin-agent-pixel
```

To attach the package to an already-existing OpenClaw `pixel` agent without overwriting their workspace files:
```bash
bakin agents install ./agents/pixel --adopt pixel
```
