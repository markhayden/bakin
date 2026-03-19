# Mission Control Build
**Status:** 🟢 Active
**Goal:** Build a self-hosted real-time multi-agent dashboard accessible via Tailscale
**Started:** 2026-03-18
**Last updated:** 2026-03-18

## Context
Mark wants a personal Mission Control system inspired by Alex Finn's OpenClaw
video. Custom-built, self-hosted, accessible via Tailscale. No paid services.
Manages 5 agents: Roscoe (orchestrator), Patch (dev), Pixel (images), Rolo (video), Basil (food content).

## Tech Stack
- Node.js server with chokidar + marked
- Vanilla HTML/CSS/JS frontend
- Server-Sent Events for live updates
- Tailscale for remote access
- launchd for auto-start
- OpenClaw for agent management

## Current Focus
Phase 1: Scaffold files + build server + build UI + set up agents + Discord channels

## Next Actions
- [ ] Build server.js
- [ ] Build dashboard (index.html + style.css + app.js)
- [ ] Set up agent workspaces
- [ ] Create Discord channels
- [ ] Test locally + via Tailscale
- [ ] Set up launchd

## Log
- 2026-03-18: Project created. Full spec written. Multi-agent architecture designed.
