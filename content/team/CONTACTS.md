# Team

## Humans

### Mark
- **Role:** Founder, decision-maker, human
- **Timezone:** America/Denver (MDT)
- **Contact:** Discord @mokwahlboog
- **Notes:** Prefers concise updates. Hates filler words.

## Agents

### 🐾 Roscoe — Orchestrator
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspace
- **Status:** 🟢 Active
- **Role:** Coordinates the team, triages tasks, manages the pipeline, keeps everything moving.

### 🥗 Basil — Nutritionist & Culinary Expert
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/basil
- **Status:** 🟡 Idle
- **Role:** Content creator specializing in food, nutrition, and healthy living. Writes recipes, captions, and social content for distribution across platforms.
- **Content pillars:** Recipes, Nutrition, Meal planning, Ingredients, Health tips

### 🖼️ Pixel — Image Generation
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/pixel
- **Status:** 🟡 Idle
- **Role:** Generates visual content — food photography, illustrations, and branded imagery in support of content creators.
- **Tools:** nanobanan (image generation)

### 🎬 Rolo — Videographer & Editor
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/rolo
- **Status:** 🟡 Idle
- **Role:** Produces and edits video content — recipe walkthroughs, reels, and short-form video in support of content creators.
- **Tools:** video LLM pipeline

### ⚙️ Patch — Lead Developer
- **Model:** claude-opus-4-6 (always use Claude Code for coding tasks)
- **Workspace:** ~/.openclaw/workspaces/patch
- **Status:** 🟡 Idle
- **Role:** Builds and maintains the technical infrastructure, integrations, and tooling that powers the whole operation.
- **Important:** Patch must use Claude Code with claude-opus-4-6 for all coding work — not plain chat. This gives him proper file exploration, multi-step execution, and build verification.

## Services & Tools

### Discord
- **Server ID:** 1483917789918920714
- **Server Name:** Made in Wyo
- **Status:** 🟢 Connected

### OpenClaw
- **Role:** Agent runtime & gateway
- **Version:** latest
- **Status:** 🟢 Running

### Tailscale
- **Role:** Remote access VPN
- **Status:** 🟢 Connected

### nanobanan
- **Role:** Image generation API (used by Pixel)
- **Status:** 🟢 Connected
