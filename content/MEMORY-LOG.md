# Memory Log
_Significant decisions and learnings — newest first_

## 2026-03-18
- **Decision:** Going custom dashboard instead of Notion. Reason: cost + ownership + full control.
- **Decision:** Using Tailscale for remote access. Already installed on Mac mini.
- **Decision:** Stack is Node.js + chokidar + marked, vanilla HTML/CSS/JS frontend.
- **Decision:** Roscoe is sole writer to shared files (TASKBOARD.md, OFFICE.md). Other agents communicate state changes via agent-to-agent messaging. Prevents file corruption.
- **Decision:** 5-minute heartbeat interval for all agents. Roscoe monitors and alerts via Discord after 3 missed heartbeats (15 min).
- **Decision:** Append-only audit.jsonl for all state changes. No database needed for Phase 1.
- **Learned:** OpenClaw has built-in multi-agent support — agent-to-agent comms, sub-agent spawning, per-agent workspaces, gateway lifecycle management.
- **Learned:** Alex Finn's Mission Control video covers: Task Board, Calendar, Projects, Memories, Docs, Team, Office.
