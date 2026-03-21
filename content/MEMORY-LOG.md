# Memory Log
_Significant decisions and learnings — newest first_

## 2026-03-20
- Memory page redesigned with timeline view, type/agent filters, search, and write API. Stitch skill used for UI prototype.

## 2026-03-19
- **Decision:** Basil can spawn Pixel and Rolo directly as subagents — she owns the full content pipeline end to end, not just briefing.
- **Decision:** All agents (Basil, Pixel, Patch) configured with subagents.allowAgents in openclaw.json so they can spawn each other.
- **Decision:** Add Google Stitch skill for UI generation — Patch built it, installed at ~/.openclaw/skills/stitch, uses Gemini API.
- **Decision:** Memory page redesign needed — MEMORY-LOG.md not being updated regularly, UI needs Stitch redesign and write capability.
- **Decision:** Antfly (antfly.io) selected for Phase 2-3 persistent storage and semantic memory. Self-hosted, hybrid search, local ML inference.
- **Decision:** KV cache compaction principle (Attention Matching paper, MIT) to be applied at conversation layer — extract high-signal decisions before compaction, retrieve via Antfly queries instead of loading flat files.
- **Decision:** Pixel's image editing enabled — pass source image via -i flag to nano-banana-pro for iteration instead of generating fresh each time.
- **Decision:** Google Stitch MCP path unclear — API token visible in UI but MCP URL not found. Gemini API path works now and covers 90% of use case.
- **Learned:** Stitch is a Google Labs "vibe design" tool — describe UI in plain language, get production-ready HTML + Tailwind CSS. Useful for Patch to accelerate Mission Control UI work.
- **Learned:** Antfly supports: hybrid BM25 + vector search, multimodal indexing, RAG with SSE, local ONNX inference, Go/TS/Python SDKs, Gemini embeddings.
- **Learned:** OpenClaw multi-agent: each agent has isolated workspace, auth, sessions. Subagents spawned on-demand, share Gemini key via auth profile merge.
- **Learned:** nano-banana-pro skill supports generate, edit (single image via -i), and multi-image composition (up to 14 images).

## 2026-03-18
- **Decision:** Going custom dashboard instead of Notion. Reason: cost + ownership + full control.
- **Decision:** Using Tailscale for remote access. Already installed on Mac mini.
- **Decision:** Stack is Node.js + chokidar + marked, vanilla HTML/CSS/JS frontend.
- **Decision:** Roscoe is sole writer to shared files (TASKBOARD.md, OFFICE.md). Other agents communicate state changes via agent-to-agent messaging. Prevents file corruption.
- **Decision:** 5-minute heartbeat interval for all agents. Roscoe monitors and alerts via Discord after 3 missed heartbeats (15 min).
- **Decision:** Append-only audit.jsonl for all state changes. No database needed for Phase 1.
- **Decision:** Gemini API key added to Pixel and Patch auth profiles for image generation access.
- **Decision:** GitHub org is madeinwyo (not markhayden). All repos under ~/go/src/github.com/madeinwyo/.
- **Decision:** Go path convention used for all projects regardless of language.
- **Learned:** OpenClaw has built-in multi-agent support — agent-to-agent comms, sub-agent spawning, per-agent workspaces, gateway lifecycle management.
- **Learned:** Alex Finn's Mission Control video covers: Task Board, Calendar, Projects, Memories, Docs, Team, Office.
- **Learned:** Mission Control content dir is ~/go/src/github.com/madeinwyo/mission-control/content/ — NOT the OpenClaw workspace. Always write there.
- **Learned:** AGENTS.md = static rules loaded every session. memory_search = dynamic, pulls only relevant context on demand. Keep AGENTS.md lean.
