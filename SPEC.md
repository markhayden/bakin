# Mission Control — Master Spec
_Created: 2026-03-18 | Owner: Mark + Roscoe_

---

## What Is This?

A custom, self-hosted command center that gives Mark a real-time view into
everything Roscoe is doing, tracking, and thinking about. Accessible from
anywhere in the world via Tailscale. No subscriptions, no third-party SaaS,
no recurring costs. Fully owned and operated on Mark's Mac mini.

The core idea: Roscoe writes structured markdown files. A lightweight Node.js
server watches those files for changes and pushes updates to a browser dashboard
in real time via Server-Sent Events. Mark opens a bookmark on his phone or
laptop and sees a live dashboard — tasks, projects, calendar, agent status,
everything.

---

## Why This Approach

- **Markdown files** are the source of truth. They're readable without the
  dashboard, portable, version-controllable, and trivial for an AI agent to write.
- **No database** needed. The filesystem IS the database.
- **Minimal deps.** Node.js + vanilla HTML/CSS/JS + chokidar (reliable file
  watching) + marked (markdown rendering). Nothing to update, nothing to break.
- **Server-Sent Events** (SSE) give real-time push updates without the
  complexity of WebSockets.
- **Tailscale** provides secure remote access without opening ports or buying
  a domain. It's already installed.
- **launchd** keeps the server running forever, even after reboots.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Mac mini (always-on)                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐            │
│  │  OpenClaw Gateway (port 18789)                   │            │
│  │                                                  │            │
│  │  🎯 Roscoe    ⚙️ Patch    🖼️ Pixel               │            │
│  │  orchestrator  developer   image artist           │            │
│  │  (sonnet)      (opus)      (sonnet)               │            │
│  │                                                  │            │
│  │  🎬 Rolo      🥗 Basil                            │            │
│  │  video prod    food content                       │            │
│  │  (sonnet)      (sonnet)                           │            │
│  │                                                  │            │
│  │       agent-to-agent + subagent spawn            │            │
│  └──────────────────────┬───────────────────────────┘            │
│                         │ writes                                 │
│              ┌──────────▼──────────┐                             │
│              │  Shared workspace   │                             │
│              │  content/           │                             │
│              │  markdown files     │                             │
│              └──────────┬──────────┘                             │
│                         │ chokidar watch                         │
│              ┌──────────▼──────────┐                             │
│              │  MC Server          │                             │
│              │  (Node.js :3737)    │──── POST ───▶ writes back   │
│              └──────────┬──────────┘     to files + openclaw CLI │
│                         │                                        │
└─────────────────────────┼────────────────────────────────────────┘
                          │ SSE / HTTP
             ┌────────────┼────────────┐
             │            │            │
   ┌─────────▼──┐ ┌──────▼─────┐ ┌────▼───────┐
   │  Laptop    │ │  iPhone    │ │  iPad      │
   │  browser   │ │  browser   │ │  browser   │
   └────────────┘ └────────────┘ └────────────┘
        All connected via Tailscale
        http://<mac-mini-tailscale-ip>:3737

   ┌────────────────────────────────┐
   │  Discord (bidirectional)       │
   │  Roscoe relays all agent      │
   │  updates + receives commands  │
   └────────────────────────────────┘
```

---

## Directory Structure

Everything lives under the OpenClaw workspace:

Everything lives in a single git repo:
`~/go/src/github.com/madeinwyo/mission-control/`

Agent workspaces (AGENTS.md, SOUL.md, etc.) live under `~/.openclaw/workspaces/`
and are managed by OpenClaw — they're not part of this repo.

```
~/go/src/github.com/madeinwyo/mission-control/
│
├── SPEC.md                           ← This file
├── server.js                         ← Node.js server (chokidar + SSE + HTTP + write-back)
├── package.json                      ← deps: marked, chokidar
├── com.openclaw.mc.plist             ← launchd service (auto-start on boot)
│
├── content/                          ← Agent-written content files (watched by server)
│   ├── TASKBOARD.md                  ← Live task tracking (Roscoe writes, @agent tags)
│   ├── CALENDAR.md                   ← Upcoming events & deadlines
│   ├── MEMORY-LOG.md                 ← Notable agent decisions (public-safe)
│   ├── OFFICE.md                     ← ASCII office map + multi-agent status
│   ├── audit.jsonl                   ← Append-only event log (all state changes)
│   ├── heartbeats/                   ← Per-agent heartbeat JSON (each agent writes own)
│   │   ├── roscoe.json
│   │   ├── patch.json
│   │   ├── pixel.json
│   │   ├── rolo.json
│   │   └── basil.json
│   ├── assets/                       ← Generated media (Pixel images, Rolo videos)
│   │   └── <YYYY-MM-DD>-<slug>.<ext>
│   ├── inbox/                        ← Dashboard write-back queue (MC server writes)
│   │   └── <timestamp>-<action>.json
│   ├── projects/
│   │   ├── .gitkeep
│   │   └── <project-slug>.md         ← One file per project
│   ├── docs/
│   │   ├── .gitkeep
│   │   └── <reference-doc>.md        ← Reference materials
│   └── team/
│       ├── CONTACTS.md               ← People + agents + services
│       └── .gitkeep
│
└── public/                           ← Dashboard UI (served by server.js)
    ├── index.html                    ← Dashboard shell
    ├── style.css                     ← Dark theme, responsive layout
    └── app.js                        ← SSE client + DOM rendering + drag-and-drop

~/.openclaw/workspaces/               ← Per-agent workspaces (OpenClaw managed, NOT in repo)
    ├── patch/                        ← ⚙️ Patch — Developer
    │   ├── AGENTS.md, SOUL.md, IDENTITY.md, HEARTBEAT.md
    ├── pixel/                        ← 🖼️ Pixel — Image Artist
    │   ├── AGENTS.md, SOUL.md, IDENTITY.md, HEARTBEAT.md
    ├── rolo/                         ← 🎬 Rolo — Video Producer
    │   ├── AGENTS.md, SOUL.md, IDENTITY.md, HEARTBEAT.md
    └── basil/                        ← 🥗 Basil — Food Content Creator
        ├── AGENTS.md, SOUL.md, IDENTITY.md, HEARTBEAT.md
```

---

## Dashboard Sections

### 1. 🗂️ Task Board

**File:** `content/TASKBOARD.md`

This is the most important section. Roscoe updates it whenever tasks are
assigned, started, completed, or blocked.

**File format:**

```markdown
# Task Board
_Last updated: 2026-03-18 14:30 MDT_

## 🔵 In Progress
- [ ] Build nanobanan integration @patch — started 2026-03-18
- [ ] Write turmeric lentil soup recipe @basil — started 2026-03-18
- [ ] Coordinate daily content pipeline @roscoe — started 2026-03-18

## 📋 Todo
- [ ] Review Mission Control spec with Mark @roscoe
- [ ] Build MC server v1 @patch
- [ ] Create visual style guide @pixel
- [ ] Generate lentil soup hero image @pixel
- [ ] Produce lentil soup recipe video @rolo
- [ ] Set up Discord channel structure @roscoe

## ✅ Done
- [x] Create Mission Control spec document @roscoe — 2026-03-18
- [x] Research Alex Finn Mission Control video @roscoe

## 🔴 Blocked
- [ ] Video LLM pipeline setup @rolo — BLOCKED: waiting on Patch to finish integration
```

**Dashboard rendering:**
- Four columns (kanban-style) on desktop, stacked vertically on mobile
- Each task is a card
- Done tasks are greyed out with strikethrough
- Blocked tasks are highlighted red
- "Last updated" timestamp shown at top
- Roscoe updates this file; dashboard re-renders automatically via SSE

---

### 2. 📅 Calendar

**File:** `content/CALENDAR.md`

Upcoming events, deadlines, and scheduled automated tasks.

**File format:**

```markdown
# Calendar
_Last updated: 2026-03-18_

## 2026-03-19 (Tomorrow)
- 09:00 MDT — Daily brief delivered to #mc-daily-brief (automated)
- 14:00 MDT — Project review reminder

## 2026-03-20
- 09:00 MDT — Daily brief (automated)

## 2026-03-25
- Deadline: Mission Control Phase 1 complete

## Recurring
- Daily @ 09:00 MDT — Daily brief (Roscoe → #mc-daily-brief)
- Weekly Mon @ 08:00 MDT — Weekly summary
```

**Dashboard rendering:**
- Chronological list
- Next 48 hours highlighted at top
- Today's items shown first in a "Today" card
- Past items automatically dimmed (CSS, based on date parsing)

---

### 3. 📁 Projects

**Files:** `content/projects/<project-slug>.md`

One markdown file per project. Roscoe creates these when new projects start
and updates them as work progresses.

**File format:**

```markdown
# Mission Control Build
**Status:** 🟢 Active
**Goal:** Build a self-hosted real-time dashboard for Roscoe's activity
**Started:** 2026-03-18
**Last updated:** 2026-03-18

## Context
Mark wants a personal Mission Control system inspired by Alex Finn's OpenClaw
video. Custom-built, self-hosted, accessible via Tailscale. No paid services.

## Tech Stack
- Node.js server (no framework)
- Vanilla HTML/CSS/JS frontend
- Server-Sent Events for live updates
- Tailscale for remote access
- launchd for auto-start

## Current Focus
Phase 1: Scaffold files + build server + build UI + test

## Next Actions
- [ ] Scaffold all markdown files
- [ ] Write server.js
- [ ] Write index.html + style.css + app.js
- [ ] Test locally
- [ ] Test via Tailscale

## Log
- 2026-03-18: Project created. Full spec written.
```

**Dashboard rendering:**
- Sidebar shows all projects with status dot (🟢 Active / 🟡 Paused / ⚫ Complete)
- Click project → full detail view in main panel
- Status badges color-coded
- Log shown as timeline at bottom

---

### 4. 🧠 Memory Log

**File:** `content/MEMORY-LOG.md`

A public-safe subset of Roscoe's memory. Decisions made, lessons learned,
important context. NOT the private MEMORY.md (which has personal info) — this
is specifically for the dashboard.

**File format:**

```markdown
# Memory Log
_Significant decisions and learnings — newest first_

## 2026-03-18
- **Decision:** Going custom dashboard instead of Notion. Reason: cost + ownership.
- **Decision:** Using Tailscale for remote access. Already installed on Mac mini.
- **Decision:** Stack is Node.js + vanilla JS, no framework, zero deps (except marked).
- **Learned:** Alex Finn's Mission Control video covers: Task Board, Calendar,
  Projects, Memories, Docs, Team, Office.
```

**Dashboard rendering:**
- Reverse chronological list
- Each entry is a card grouped by date
- Decision entries highlighted differently from Learned entries
- Search box to filter entries

---

### 5. 📚 Docs

**Files:** `content/docs/<name>.md`

Reference documents. SOPs, research notes, prompt templates, anything Roscoe
or Mark might need to reference. Roscoe can add docs here when creating
research or reference material.

**File format:** Any structured markdown. No required schema.

Examples:
- `docs/daily-brief-template.md`
- `docs/stock-research-thesis.md`
- `docs/discord-channel-structure.md`
- `docs/prompt-library.md`

**Dashboard rendering:**
- Grid of doc cards with title, last modified date
- Click to open full doc in a modal/panel
- Live search across all docs

---

### 6. 👥 Team

**File:** `content/team/CONTACTS.md`

Everyone and everything in the ecosystem — humans, sub-agents, tools, services.

**File format:**

```markdown
# Team

## Humans

### Mark
- **Role:** Founder, decision-maker, human
- **Timezone:** America/Denver (MDT)
- **Contact:** Discord @mokwahlboog
- **Notes:** Prefers concise updates. Hates filler words.

## Agents

### 🎯 Roscoe — Orchestrator
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspace
- **Status:** 🟢 Active
- **Voice:** "Alright crew, here's today's mission..."

### ⚙️ Patch — Developer
- **Model:** claude-opus-4-6
- **Workspace:** ~/.openclaw/workspaces/patch
- **Status:** 🟢 Active
- **Voice:** "Give me 10 minutes, I can automate that."

### 🖼️ Pixel — Image Artist
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/pixel
- **Status:** 🟡 Idle
- **Voice:** "The lighting was off, I ran it again. This one's perfect."
- **Tools:** nanobanan (image generation)

### 🎬 Rolo — Video Producer
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/rolo
- **Status:** 🟡 Idle
- **Voice:** "I'm thinking we open on the dish, slow zoom..."
- **Tools:** video LLM pipeline

### 🥗 Basil — Food Content Creator
- **Model:** claude-sonnet-4-6
- **Workspace:** ~/.openclaw/workspaces/basil
- **Status:** 🟢 Active
- **Voice:** "Today we're making a 20-minute turmeric lentil soup..."
- **Content pillars:** Recipes, Nutrition, Meal planning, Ingredients, Infographics

## Services & Tools

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
```

**Dashboard rendering:**
- Card grid — one card per team member
- Status dot on each card
- Agent cards show current task from TASKBOARD.md
- Agent cards show health: last heartbeat, error count, uptime

---

### 7. 🏢 Office

**File:** `content/OFFICE.md`

The fun one. A 2D ASCII art map of a virtual office. Roscoe rebuilds this on
each heartbeat from all agents' heartbeat JSON files. Shows where every agent
"is" in the office and what they're working on.

**File format:**

```markdown
# Office
_Updated: 2026-03-18 14:45 MDT_

\`\`\`
╔═════════════════════════════════════════════════════════════════╗
║                    🏢  MISSION CONTROL HQ                       ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐      ║
║   │ COMMAND   │ │ WORKSHOP  │ │ STUDIO    │ │ STAGE     │      ║
║   │  🎯       │ │  ⚙️       │ │  🖼️       │ │  🎬       │      ║
║   │ [Roscoe]  │ │ [Patch]   │ │ [Pixel]   │ │ [Rolo]    │      ║
║   │ 🟢 Working│ │ 🟢 Working│ │ 🟡 Idle   │ │ 🟡 Idle   │      ║
║   └───────────┘ └───────────┘ └───────────┘ └───────────┘      ║
║                                                                 ║
║   ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐    ║
║   │  TEST KITCHEN │  │  WHITEBOARD  │  │  CONTENT ROOM    │    ║
║   │   🥗          │  │  📋 📊 📈    │  │  📝 📸 🎥        │    ║
║   │  [Basil]      │  │              │  │                  │    ║
║   │  🟢 Working   │  │              │  │                  │    ║
║   └───────────────┘  └──────────────┘  └──────────────────┘    ║
║                                                                 ║
╚═════════════════════════════════════════════════════════════════╝
\`\`\`

## Agent Status
| Agent | Status | Current Task | Last Heartbeat |
|-------|--------|-------------|----------------|
| 🎯 Roscoe | 🟢 Working | Coordinating daily content pipeline | 14:45 MDT |
| ⚙️ Patch | 🟢 Working | Building nanobanan integration | 14:44 MDT |
| 🖼️ Pixel | 🟡 Idle | Waiting for image brief | 14:40 MDT |
| 🎬 Rolo | 🟡 Idle | Waiting for video brief | 14:40 MDT |
| 🥗 Basil | 🟢 Working | Writing turmeric lentil soup recipe | 14:43 MDT |

## Status History
- 14:45 — Roscoe: Working — Coordinating daily content pipeline
- 14:43 — Basil: Working — Writing turmeric lentil soup recipe
- 14:44 — Patch: Working — Building nanobanan integration
- 14:40 — Pixel: Idle — Waiting for image brief from Basil
- 14:40 — Rolo: Idle — Waiting for video brief from Basil
```

**Dashboard rendering:**
- Monospace font renders the ASCII art perfectly
- Status badge shown prominently above the map
- Status history shown as a small timeline below
- Roscoe emoji moves position based on activity type (at desk = working,
  at whiteboard = planning, kitchen = idle, etc.)

---

## Tech Stack — Full Detail

### Server (server.js)

Node.js with chokidar (file watching) and marked (markdown rendering).

**Responsibilities:**
1. Serve static files from `public/` directory
2. Watch all `content/` files for changes using chokidar
3. Maintain a list of SSE client connections
4. On file change: read the changed file, broadcast update to all SSE clients
5. Expose an endpoint to get current state of all files on initial page load

**Key endpoints:**
- `GET /` → serves `public/index.html`
- `GET /api/state` → returns JSON with all mission-control file contents
- `GET /api/events` → SSE stream (client subscribes here for live updates)
- `GET /api/agents/health` → returns all heartbeat JSON files
- `POST /api/plugins/tasks/*` → task mutations (create, move, assign, delete)
- `POST /api/agents/*` → agent control (start, stop, restart)
- `GET /public/*` → static assets

**Server-Sent Events flow:**
1. Browser connects to `/api/events`
2. Server adds this connection to its client list
3. When any file changes, server reads file, sends `data: {...}\n\n` to all clients
4. Browser JS receives event, updates the relevant dashboard section in DOM
5. No page reload needed

**Approximate server.js structure:**

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { execSync } = require('child_process');

const MC_DIR = path.join(__dirname, 'content');
const INBOX_DIR = path.join(MC_DIR, 'inbox');
const HEARTBEATS_DIR = path.join(MC_DIR, 'heartbeats');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = 3737;

const clients = new Set();

// Watch mission-control directory with chokidar (reliable on macOS)
chokidar.watch(MC_DIR, { ignoreInitial: true }).on('change', (filePath) => {
  const ext = path.extname(filePath);
  if (ext !== '.md' && ext !== '.json') return;
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) return;
    const relative = path.relative(MC_DIR, filePath);
    broadcast({ file: relative, content, timestamp: Date.now() });
  });
});

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

const server = http.createServer((req, res) => {
  // SSE endpoint
  if (req.url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // State endpoint — all file contents
  if (req.url === '/api/state') { /* read all .md + .json from MC_DIR */ }

  // Agent health — all heartbeat files
  if (req.url === '/api/agents/health') { /* read all from HEARTBEATS_DIR */ }

  // Task mutations — write to inbox for Roscoe to process
  if (req.url.startsWith('/api/plugins/tasks/')) { /* write to INBOX_DIR */ }

  // Agent control — shell out to openclaw CLI
  if (req.url.startsWith('/api/agents/')) {
    // e.g., execSync('openclaw agent --agent roscoe --message "..." --deliver')
  }

  // Static files
  // ... serve from PUBLIC_DIR
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mission Control running at http://localhost:${PORT}`);
});
```

---

### Frontend (index.html + style.css + app.js)

**index.html structure:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Mission Control</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>🎛️ Mission Control</h1>
    <div id="agent-status"><!-- live status --></div>
    <div id="connection-indicator">● LIVE</div>
  </header>

  <nav id="sidebar">
    <a href="#tasks">🗂️ Tasks</a>
    <a href="#calendar">📅 Calendar</a>
    <a href="#projects">📁 Projects</a>
    <a href="#memory">🧠 Memory</a>
    <a href="#docs">📚 Docs</a>
    <a href="#team">👥 Team</a>
    <a href="#office">🏢 Office</a>
  </nav>

  <main>
    <section id="tasks"><!-- task board --></section>
    <section id="calendar"><!-- calendar --></section>
    <section id="projects"><!-- projects --></section>
    <section id="memory"><!-- memory log --></section>
    <section id="docs"><!-- docs --></section>
    <section id="team"><!-- team --></section>
    <section id="office"><!-- office --></section>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

**style.css theme:**
- Dark background: `#0d1117` (GitHub dark style)
- Card backgrounds: `#161b22`
- Accent: `#58a6ff` (blue)
- Success/active: `#3fb950` (green)
- Warning/blocked: `#f85149` (red)
- Text: `#c9d1d9`
- Monospace font for office map: `JetBrains Mono` or `Consolas`
- CSS Grid layout — sidebar fixed left, content scrolls right
- Responsive: sidebar collapses to top nav on mobile

**app.js responsibilities:**
1. On load: fetch `/api/state` to populate all sections
2. Connect to `/api/events` SSE stream
3. On SSE message: parse which file changed, re-render that section only
4. Parse markdown using `marked` (loaded from CDN or bundled)
5. Task board: parse checkboxes and headers into kanban columns
6. Calendar: parse dates, highlight upcoming items
7. Office: render ASCII art in `<pre>` block

---

## Remote Access Setup

### Step 1: Find Mac mini's Tailscale IP
- Open Tailscale app on Mac mini
- Click the Tailscale menu bar icon
- Copy the IP address (format: `100.x.x.x`)
- Or use MagicDNS hostname if enabled (e.g. `mac-mini.tail1234.ts.net`)

### Step 2: Start the server
```bash
cd ~/go/src/github.com/madeinwyo/mission-control
node server.js
```

### Step 3: Access from any Tailscale device
- Open browser on phone/laptop/tablet
- Navigate to: `http://100.x.x.x:3737`
- Bookmark it

### Step 4: Auto-start on boot (launchd)

Create `~/Library/LaunchAgents/com.openclaw.mc.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.mc</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/roscoe/go/src/github.com/madeinwyo/mission-control/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/mc-server.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mc-server-error.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.mc.plist
```

Now the server starts automatically on login and restarts if it crashes.

---

## Multi-Agent Architecture

### Overview

Mission Control manages multiple OpenClaw agents. **Roscoe is the orchestrator** —
it assigns tasks to specialized agents, monitors their health, relays updates to
Discord, and handles anything that doesn't fit a specialist. Other agents are
focused on specific capabilities (image generation, development, research, etc.).

All agents run within the **OpenClaw Gateway** on the Mac mini. OpenClaw already
provides agent lifecycle management, per-agent workspaces, agent-to-agent
communication, and sub-agent spawning. Mission Control doesn't reinvent these —
it reads the state OpenClaw exposes and provides a visual layer + interactive
controls.

### Agent Registry (via OpenClaw)

Agents are defined in `~/.openclaw/openclaw.json` using OpenClaw's built-in
multi-agent config. Each agent gets its own workspace but shares the
`content/` directory for coordinated state.

```json5
// ~/.openclaw/openclaw.json — agents section
{
  "agents": {
    "list": [
      {
        "id": "roscoe",
        "workspace": "~/.openclaw/workspace",
        "model": { "primary": "anthropic/claude-sonnet-4-6" },
        "default": true
        // Orchestrator — delegates, monitors, arbitrates, schedules
      },
      {
        "id": "patch",
        "workspace": "~/.openclaw/workspaces/patch",
        "model": { "primary": "anthropic/claude-opus-4-6" }
        // Developer — builds, debugs, deploys, integrates
      },
      {
        "id": "pixel",
        "workspace": "~/.openclaw/workspaces/pixel",
        "model": { "primary": "anthropic/claude-sonnet-4-6" }
        // Image artist — prompts nanobanan, maintains visual style guide
      },
      {
        "id": "rolo",
        "workspace": "~/.openclaw/workspaces/rolo",
        "model": { "primary": "anthropic/claude-sonnet-4-6" }
        // Video producer — scripts, sequences, video LLM pipeline
      },
      {
        "id": "basil",
        "workspace": "~/.openclaw/workspaces/basil",
        "model": { "primary": "anthropic/claude-sonnet-4-6" }
        // Nutritionist & food content creator — plans, writes, briefs
      }
    ],
    "defaults": {
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    }
  },
  "tools": {
    "agentToAgent": {
      "enabled": true,
      "allow": ["roscoe", "patch", "pixel", "rolo", "basil"]
    }
  }
}
```

**CLI commands for agent management:**
```bash
openclaw agents add patch --workspace ~/.openclaw/workspaces/patch
openclaw agents list
openclaw agents set-identity --agent patch --name "Patch" --emoji "⚙️"
openclaw agents delete patch
```

### Agent Roster

| Agent | Role | Model | Voice |
|-------|------|-------|-------|
| 🎯 Roscoe | Orchestrator | sonnet | "Alright crew, here's today's mission..." |
| ⚙️ Patch | Developer | opus | "Give me 10 minutes, I can automate that." |
| 🖼️ Pixel | Image Artist | sonnet | "The lighting was off, I ran it again. This one's perfect." |
| 🎬 Rolo | Video Producer | sonnet | "I'm thinking we open on the dish, slow zoom..." |
| 🥗 Basil | Food Content Creator | sonnet | "Today we're making a 20-minute turmeric lentil soup..." |

### Agent Responsibilities

**🎯 Roscoe — The Orchestrator**
- Receives high-level goals, breaks them into tasks
- Delegates to Patch, Pixel, Rolo, Basil
- Monitors task completion, handles failures/retries
- Manages scheduling and posting queues across platforms
- Arbitrates conflicts between agents
- Maintains the master content calendar
- Relays all Discord communication (single bot)

**⚙️ Patch — The Developer**
- Builds and maintains API integrations and tool connections
- Creates and updates automation workflows
- Debugs issues flagged by Roscoe or other agents
- Manages platform SDKs and authentication
- Extends agent capabilities with new tools as needed

**🖼️ Pixel — The Image Artist**
- Receives image briefs from content agents (primarily Basil)
- Crafts detailed prompts for nanobanan to generate high-quality imagery
- Iterates on outputs until quality bar is met
- Maintains a visual style guide and visual consistency
- Delivers final assets back to the requesting agent
- Archives all generated assets with metadata

**🎬 Rolo — The Video Producer**
- Receives video briefs and scripts from content agents (primarily Basil)
- Generates video assets via video LLM tooling
- Handles sequencing, transitions, and pacing
- Coordinates with Pixel when static images are needed as video components
- Delivers finished video assets back to the requesting agent
- Maintains a library of reusable video templates and styles

**🥗 Basil — The Nutritionist & Food Content Creator**
- Maintains a daily content calendar (food, health, recipes, nutrition)
- Writes all copy — captions, recipe steps, health tips, educational posts
- Briefs Pixel on image assets (dish photography, infographics, ingredient flats)
- Briefs Rolo on video assets (recipe walkthroughs, quick tips)
- Receives completed assets, assembles the final post package
- Hands completed packages to Roscoe for scheduling and publishing
- Content pillars: Recipes, Nutrition education, Meal planning, Ingredient spotlights, Health infographics

### Content Pipeline Flow

```
Basil (plans content, writes copy)
  ├──▶ Pixel (image brief) ──▶ nanobanan ──▶ assets back to Basil
  ├──▶ Rolo (video brief) ──▶ video LLM ──▶ assets back to Basil
  │         └──▶ Pixel (still frames needed for video)
  │
  Basil (assembles final post package)
  └──▶ Roscoe (scheduling + publishing across platforms)

Patch supports the whole pipeline:
  - builds integrations, fixes bugs, extends tooling
  - called by Roscoe when something breaks or needs automation
```

### Agent Communication

Agents communicate through OpenClaw's built-in mechanisms:

1. **Sub-agent spawning** — Roscoe delegates tasks:
   ```
   /subagents spawn pixel "Generate hero image for turmeric lentil soup recipe"
   /subagents spawn patch "Write the server.js file per SPEC.md"
   /subagents spawn basil "Plan next week's content calendar"
   ```

2. **Agent-to-agent messaging** — enabled via `tools.agentToAgent` in config.
   Agents can send messages directly to other agents within the gateway.

3. **Shared state via files** — all agents have read/write access to
   `content/` files. TASKBOARD.md is the coordination hub.
   - `@agent-name` ownership tags on tasks indicate assignment
   - `@unassigned` tasks are available for Roscoe to delegate

4. **Results flow back through Roscoe** — when a sub-agent completes, OpenClaw
   announces the result back to the requesting agent. Roscoe then updates
   TASKBOARD.md and relays to Discord if needed.

### Heartbeat System

Every agent runs a heartbeat every **5 minutes**. This is handled via OpenClaw's
built-in `HEARTBEAT.md` convention — each agent's workspace contains a
`HEARTBEAT.md` checklist that runs on a timer.

**Per-agent heartbeat writes to shared state:**

Each agent writes a heartbeat file to the shared mission-control directory:
```
~/.openclaw/workspace/content/heartbeats/
  roscoe.json
  patch.json
  pixel.json
  rolo.json
  basil.json
```

**Heartbeat file format:**
```json
{
  "agent": "roscoe",
  "status": "working",
  "currentTask": "Researching stock picks for AI thesis",
  "timestamp": "2026-03-18T14:45:00-06:00",
  "uptime": 3600,
  "errorCount": 0,
  "lastError": null
}
```

**Each agent's HEARTBEAT.md contains:**
```markdown
- [ ] Write heartbeat JSON to content/heartbeats/<my-id>.json
- [ ] Update my status line in content/OFFICE.md
- [ ] Check content/TASKBOARD.md for new tasks assigned to me
```

**Roscoe's HEARTBEAT.md additionally contains:**
```markdown
- [ ] Check all heartbeat files in content/heartbeats/
- [ ] If any agent missed 3 consecutive heartbeats (15 min), post Discord alert
- [ ] Update OFFICE.md agent status table
- [ ] Verify TASKBOARD.md task states are consistent
```

### Concurrency & File Locking

Multiple agents writing to shared files (TASKBOARD.md, OFFICE.md) risks
corruption. Mitigation strategy:

1. **Roscoe is the primary writer** for shared files. Other agents write to
   their own heartbeat JSON files (no conflict — one file per agent).

2. **TASKBOARD.md updates flow through Roscoe.** When Patch or Basil finishes
   a task, they tell Roscoe via agent-to-agent messaging. Roscoe updates
   TASKBOARD.md. This serializes writes through a single agent.

3. **OFFICE.md is rebuilt by Roscoe** on each heartbeat cycle. Roscoe reads
   all heartbeat JSON files and regenerates the office map + status table.
   Other agents don't write to OFFICE.md directly.

4. **Per-agent files are safe.** Each agent's heartbeat JSON, workspace files,
   and session logs are isolated — no concurrent write risk.

5. **Dashboard writes** (from POST endpoints) also go through Roscoe.
   The MC server writes changes to a `content/inbox/` directory.
   Roscoe picks up inbox items on heartbeat and applies them.

```
Dashboard POST /api/plugins/tasks/:taskId/assign
  → MC server writes content/inbox/1710782400-assign.json
  → Roscoe picks up on next heartbeat (≤5 min)
  → Roscoe updates TASKBOARD.md
  → fs.watch fires → SSE pushes update to dashboard
```

For time-sensitive actions (task assignment, agent start/stop), the MC server
can also trigger Roscoe directly via the OpenClaw gateway API:
```bash
openclaw agent --agent roscoe --message "Mark assigned 'Build MC server v1' to patch" --deliver
```

---

## Dashboard Write-Back API

The dashboard is interactive — Mark can assign tasks, move items, and control
agents. These changes flow through the MC server back to the markdown files.

### Task Endpoints
```
POST /api/plugins/tasks/          — { title, column, assignee }
POST /api/plugins/tasks/:id/move  — { fromColumn, toColumn }
POST /api/plugins/tasks/:id/assign — { agent }
DELETE /api/plugins/tasks/:id     — {}
```

### Agent Control Endpoints
```
POST /api/agents/start   — { agentId }  → openclaw agents start <id>
POST /api/agents/stop    — { agentId }  → openclaw agents stop <id>
POST /api/agents/restart — { agentId }  → openclaw agents restart <id>
GET  /api/agents/health  — returns all heartbeat JSON files
```

### Implementation
- Task endpoints write changes to `content/inbox/` for Roscoe to process
- Agent control endpoints shell out to `openclaw` CLI directly (immediate)
- All writes trigger fs.watch → SSE update loop automatically

---

## Audit Log

**File:** `content/audit.jsonl`

An append-only event log that records every state change in the system. One JSON
object per line. This is the single source of truth for "what happened when" —
enables metrics, debugging, and accountability without a database.

**Who writes:** Roscoe appends to this file whenever it updates shared state.
The MC server also appends directly for dashboard-initiated actions.

**Event format:**
```jsonl
{"ts":"2026-03-18T14:30:00-06:00","event":"task.created","agent":"roscoe","data":{"title":"Build MC server v1","assignee":"patch","column":"todo"}}
{"ts":"2026-03-18T14:31:00-06:00","event":"task.moved","agent":"roscoe","data":{"title":"Build MC server v1","from":"todo","to":"in_progress"}}
{"ts":"2026-03-18T14:32:00-06:00","event":"task.assigned","agent":"mark","data":{"title":"Generate lentil soup hero image","assignee":"pixel","via":"dashboard"}}
{"ts":"2026-03-18T14:35:00-06:00","event":"heartbeat","agent":"basil","data":{"status":"working","task":"Writing turmeric lentil soup recipe"}}
{"ts":"2026-03-18T14:40:00-06:00","event":"task.completed","agent":"patch","data":{"title":"Build nanobanan integration","duration_min":120}}
{"ts":"2026-03-18T14:41:00-06:00","event":"agent.health","agent":"roscoe","data":{"target":"rolo","status":"stale","missed_heartbeats":3}}
{"ts":"2026-03-18T14:42:00-06:00","event":"agent.restart","agent":"roscoe","data":{"target":"rolo","reason":"missed 3 heartbeats"}}
{"ts":"2026-03-18T15:00:00-06:00","event":"asset.created","agent":"pixel","data":{"file":"2026-03-18-lentil-soup-hero.jpg","brief_from":"basil","type":"image"}}
{"ts":"2026-03-18T15:10:00-06:00","event":"content.published","agent":"roscoe","data":{"platform":"discord","channel":"#recipes","assets":["2026-03-18-lentil-soup-hero.jpg"]}}
```

**Event types:**
| Event | Description | Writer |
|-------|-------------|--------|
| `task.created` | New task added to board | Roscoe / MC server |
| `task.moved` | Task moved between columns | Roscoe / MC server |
| `task.assigned` | Task assigned to agent | Roscoe / MC server |
| `task.completed` | Task marked done | Roscoe |
| `task.blocked` | Task blocked | Roscoe |
| `heartbeat` | Agent heartbeat received | Roscoe |
| `agent.health` | Health status change (stale, recovered) | Roscoe |
| `agent.start` | Agent started | MC server |
| `agent.stop` | Agent stopped | MC server |
| `agent.restart` | Agent restarted | Roscoe / MC server |
| `asset.created` | Image/video generated | Pixel / Rolo (via Roscoe) |
| `content.published` | Content posted to platform | Roscoe |
| `decision` | Significant decision logged | Any agent |
| `inbox.processed` | Dashboard inbox item handled | Roscoe |

**Dashboard rendering (Phase 2):**
- Activity feed showing recent events in real-time
- Agent performance charts (tasks completed per agent, avg completion time)
- Uptime history (derived from heartbeat events)
- Filterable by agent, event type, date range

**Rotation:** When `audit.jsonl` exceeds 10MB, Roscoe rotates it to
`audit-YYYY-MM-DD.jsonl` and starts a fresh file. Old files kept for 90 days.

---

## Assets

**Directory:** `content/assets/`

Binary files generated by Pixel (images) and Rolo (videos). Stored with
structured filenames for easy lookup.

**Naming convention:**
```
<YYYY-MM-DD>-<slug>-<type>.<ext>
```

Examples:
```
2026-03-18-lentil-soup-hero.jpg
2026-03-18-lentil-soup-ingredients-flat.jpg
2026-03-18-lentil-soup-recipe-walkthrough.mp4
2026-03-19-macro-breakdown-infographic.png
```

**Metadata:** Each asset creation is logged in `audit.jsonl` with the event
`asset.created`, including which agent created it, who requested it, and the
brief that produced it.

**Workflow:**
1. Basil sends image brief to Pixel via agent-to-agent message
2. Pixel generates image via nanobanan, saves to `assets/`
3. Pixel logs `asset.created` event (via Roscoe)
4. Pixel notifies Basil that asset is ready
5. Basil assembles final post package referencing the asset path

**Dashboard rendering:**
- Assets grid in a sub-section (or within the project detail view)
- Thumbnail previews for images
- Filterable by date, agent, project

---

## Agent Integration (AGENTS.md Updates)

### All agents' AGENTS.md should include:

```markdown
## Mission Control Integration

On every session start:
1. Read `content/TASKBOARD.md` — know what's active and assigned to you
2. Read `content/CALENDAR.md` — know what's coming up

On task changes:
- Notify Roscoe via agent-to-agent message when tasks start, complete, or block
- Do NOT write to TASKBOARD.md directly — Roscoe manages the shared board

On heartbeat (every 5 minutes):
- Write your heartbeat JSON to content/heartbeats/<your-id>.json
- Check TASKBOARD.md for new tasks assigned to you
```

### Roscoe's AGENTS.md additionally includes:

```markdown
## Orchestrator Responsibilities

You are the orchestrator. You coordinate all other agents.

On every session start:
1. Read all files in content/ — know full system state
2. Check heartbeats/ — verify all agents are healthy
3. Review TASKBOARD.md — ensure assignments are current

On task assignment (from Mark via dashboard or Discord):
- Update TASKBOARD.md with @agent-name tag
- Spawn sub-agent or send agent-to-agent message to assigned agent
- Confirm assignment in Discord #mc-tasks

On agent health issue:
- If agent misses 3 heartbeats (15 min), post alert to Discord #mc-alerts
- Attempt restart via openclaw CLI
- Update OFFICE.md status to 🔴

On significant decisions:
- Append to MEMORY-LOG.md

On heartbeat (every 5 minutes):
- Read all heartbeat JSONs, rebuild OFFICE.md agent status table
- Log heartbeat events to audit.jsonl for each agent
- Process any items in content/inbox/
- Verify TASKBOARD.md consistency
- Update your own heartbeat JSON
- If audit.jsonl > 10MB, rotate to audit-YYYY-MM-DD.jsonl
```

### What triggers file writes

| Trigger | File | Writer |
|---------|------|--------|
| Task state change | TASKBOARD.md | Roscoe only |
| Heartbeat | heartbeats/<agent>.json | Each agent |
| Heartbeat | OFFICE.md | Roscoe only |
| Significant decision | MEMORY-LOG.md | Any agent (append-only) |
| Dashboard interaction | inbox/*.json | MC server |
| Calendar event | CALENDAR.md | Roscoe only |
| New project | projects/<slug>.md | Roscoe only |
| Any state change | audit.jsonl | Roscoe + MC server (append-only) |
| Image/video generated | assets/<file> | Pixel / Rolo |

---

## Discord Integration

Discord is bidirectional. Roscoe is the single bot — no need for per-agent bots.
Discord is already configured as an OpenClaw channel.

### Channels

| Channel | Purpose | Direction |
|---------|---------|-----------|
| `#mc-tasks` | Task state changes (new, completed, blocked, assigned) | Outbound |
| `#mc-daily-brief` | Morning summary — calendar + tasks + priorities | Outbound |
| `#mc-alerts` | Agent health alerts, errors, missed heartbeats | Outbound |
| `#mc-commands` | Mark sends commands to agents | Inbound |

### Inbound Commands (from Mark via Discord)
```
@roscoe assign "Generate lentil soup hero image" to pixel
@roscoe status
@roscoe restart rolo
@roscoe prioritize "Build MC server v1"
```
Roscoe parses these and acts accordingly — updates TASKBOARD.md, runs CLI
commands, etc.

### Outbound Notifications
```
📋 TASK: "Generate lentil soup hero image" assigned to @pixel by Mark
✅ DONE: @patch completed "Build nanobanan integration"
🔴 ALERT: rolo hasn't checked in for 15 minutes
🟢 RECOVERED: rolo is back online
🔵 STARTED: @basil started "Write turmeric lentil soup recipe"
```

### Daily Brief (09:00 MDT via OpenClaw cron)

```
🌅 Daily Brief — Wed Mar 19

🤖 Agent Status
  🎯 Roscoe: 🟢 | ⚙️ Patch: 🟢 | 🖼️ Pixel: 🟡 | 🎬 Rolo: 🟡 | 🥗 Basil: 🟢

📋 Active Tasks (3)
  • Coordinate daily content pipeline @roscoe
  • Build nanobanan integration @patch
  • Write turmeric lentil soup recipe @basil

📅 Today
  • 09:00 — This brief (done ✅)
  • 10:00 — Basil posts recipe content
  • 14:00 — Project review reminder

🎯 Top Priority
  Build MC server v1 @patch — Phase 1 target
```

---

## Build Checklist

### Phase 1 — Foundation (Basic but Complete)

**Content files:**
- [x] Write SPEC.md (this file)
- [ ] Create `content/TASKBOARD.md` with ownership tags template
- [ ] Create `content/CALENDAR.md` with template
- [ ] Create `content/MEMORY-LOG.md` with template
- [ ] Create `content/OFFICE.md` with multi-agent ASCII map
- [ ] Create `content/team/CONTACTS.md` with multi-agent entries
- [ ] Create `content/projects/mission-control-build.md`
- [ ] Create `content/heartbeats/` directory
- [ ] Create `content/inbox/` directory
- [ ] Create `content/assets/` directory
- [ ] Create `content/audit.jsonl` (empty)

**Agent setup:**
- [ ] Add agents to `openclaw.json` (patch, pixel, rolo, basil)
- [ ] Create workspaces: `~/.openclaw/workspaces/{patch,pixel,rolo,basil}/`
- [ ] Write AGENTS.md for each agent (role-specific instructions)
- [ ] Write SOUL.md for each agent (personality, voice, boundaries)
- [ ] Write IDENTITY.md for each agent (name, emoji, avatar)
- [ ] Write HEARTBEAT.md for each agent (5 min interval checklist)
- [ ] Enable `tools.agentToAgent` in openclaw.json
- [ ] Set agent identities via CLI (`openclaw agents set-identity`)
- [ ] Update Roscoe's AGENTS.md with orchestrator responsibilities
- [ ] Update Roscoe's AGENTS.md with content pipeline flow

**Server:**
- [ ] Create `server.js` with chokidar file watching
- [ ] Add read endpoints: `/api/state`, `/api/events` (SSE)
- [ ] Add write endpoints: `/api/plugins/tasks/*`, `/api/agents/*`
- [ ] Serve static files from `public/`
- [ ] Create `public/index.html` — dashboard shell
- [ ] Create `public/style.css` — dark theme, responsive
- [ ] Create `public/app.js` — SSE client, DOM rendering, drag-and-drop

**Dashboard features (basic):**
- [ ] Task board with kanban columns + ownership badges
- [ ] Calendar view
- [ ] Projects sidebar
- [ ] Memory log
- [ ] Docs grid
- [ ] Team cards with agent health
- [ ] Office ASCII map with multi-agent status
- [ ] Drag-and-drop task assignment (assign agent via dropdown)
- [ ] Agent start/stop/restart buttons

**Discord:**
- [ ] Create #mc-tasks, #mc-daily-brief, #mc-alerts, #mc-commands channels
- [ ] Wire Roscoe to post task state changes to #mc-tasks
- [ ] Wire Roscoe to post health alerts to #mc-alerts
- [ ] Set up 09:00 MDT daily brief via OpenClaw cron
- [ ] Wire inbound commands from #mc-commands

**Infrastructure:**
- [ ] Test locally: `http://localhost:3737`
- [ ] Get Mac mini Tailscale IP from Mark
- [ ] Test remotely via Tailscale
- [ ] Create launchd plist for MC server auto-start
- [ ] Verify OpenClaw gateway launchd service is running
- [ ] Load both launchd services
- [ ] End-to-end test: dashboard + agents + Discord

### Phase 2 — Polish & Scale
- [ ] Mobile-optimized layout (test on iPhone)
- [ ] Favicon + PWA manifest (add to home screen)
- [ ] Search across docs
- [ ] Project templates (auto-scaffold new project files)
- [ ] Office map: animate status changes
- [ ] Dark/light mode toggle
- [ ] Agent performance metrics (tasks completed, avg time, error rate)
- [ ] Historical uptime tracking
- [ ] Add more specialized agents as needed

---

---

## Phase 2-3: Antfly — Persistent Storage & Semantic Memory

_Added: 2026-03-19_

### The Problem With Flat Files

Phase 1 uses markdown files as the source of truth. This works great early on
but has hard limits:

- `memory_search` indexes local files — quality degrades as files grow
- Every session loads static context regardless of relevance (fixed token cost)
- No way to query "what decisions did we make about X?" efficiently
- Agent memory is bounded by what fits in the context window

As the system matures — more agents, more tasks, months of history — this
becomes a real bottleneck both in quality and cost.

### The Antfly Solution

**Antfly (AntflyDB)** is a self-hosted, AI-native document database that gives
us persistent vector storage, hybrid search, and RAG built in. No cloud, no
recurring cost, runs locally on the Mac mini alongside OpenClaw.

Key capabilities relevant to Mission Control:
- **Hybrid search** — BM25 (keyword) + vector similarity via Reciprocal Rank
  Fusion. "Token costs" and "API spend" both surface the same memory.
- **Automatic embedding** — documents are chunked and embedded in the
  background. Supports Gemini embeddings (already in our stack).
- **RAG built in** — streaming retrieval with SSE, no pipeline assembly needed.
- **Multimodal** — can index Pixel's generated image assets alongside text.
- **Local ML inference** — embeddings run via ONNX locally, data never leaves
  the Mac mini.
- **Go/TypeScript/Python SDKs** — easy to integrate with our Node.js MC server.

### Token Optimization Architecture

**Current (Phase 1):**
```
Session start → load files → fixed token cost regardless of relevance
```

**With Antfly (Phase 2+):**
```
Session start → query Antfly → only relevant chunks enter context window
```

The difference at scale is massive. A system with 6 months of decisions,
project notes, and conversation summaries would cost the same per query as
day one — because only the relevant ~10 chunks load, not the entire history.

### What Gets Stored in Antfly

| Content Type | Source | How Indexed |
|---|---|---|
| Task history | TASKBOARD.md entries | On completion, write to Antfly with tags |
| Decisions | MEMORY-LOG.md entries | On write, sync to Antfly |
| Project context | projects/*.md | On create/update, sync to Antfly |
| Conversation summaries | End of session | Agent writes summary to Antfly |
| Docs / reference | docs/*.md | On create, sync to Antfly |
| Image assets | content/assets/ | Indexed with metadata (prompt, date, tags) |

### Migration Plan

**Phase 2 — Dual-write (non-breaking):**
1. Stand up Antfly locally on Mac mini (Docker or binary)
2. Build a lightweight sync layer: every markdown write also writes to Antfly
3. Add `antfly_search` queries alongside existing `memory_search`
4. Compare quality — validate Antfly is returning better results
5. Gradually shift agents to prefer Antfly queries over file reads

**Phase 3 — Antfly as primary store:**
1. Agents query Antfly first, fall back to files only if needed
2. AGENTS.md stays lean (static rules only)
3. All dynamic context comes from Antfly queries
4. Eventually phase out bulk file reads entirely

### Repo
When ready to build: `~/go/src/github.com/madeinwyo/antfly-integration/`

### Reference
- Website: <https://antfly.io>
- Docs: <https://antfly.io/docs>
- Evaluated: 2026-03-19

---

## Open Decisions

| Decision | Options | Status |
|----------|---------|--------|
| Port | 3737 (default) or custom | ✅ 3737 |
| Auth | None (Tailscale handles it) | ✅ Tailscale only |
| Markdown rendering | `marked` via CDN | ✅ CDN |
| Dashboard default section | Task Board | ✅ Task Board |
| Mobile layout | Tabs or top nav | 🔲 TBD |
| File watcher | `chokidar` (reliable) vs `fs.watch` (zero-dep) | ✅ chokidar |
| Heartbeat interval | 5 minutes for all agents | ✅ 5 min |
| Shared file write strategy | Roscoe-only writes + inbox pattern | ✅ Decided |

---

## Notes & References

- Alex Finn Mission Control video: <https://youtu.be/RhLpV6QDBFE>
- Alex Finn OpenClaw overview video: <https://www.youtube.com/watch?v=CxErCGVo-oo>
- OpenClaw docs (local): `/opt/homebrew/lib/node_modules/openclaw/docs`
- OpenClaw CLI reference: `openclaw --help`, `openclaw agents --help`
- OpenClaw config: `~/.openclaw/openclaw.json`
- Server-Sent Events MDN reference: <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events>
- marked.js (markdown renderer): <https://marked.js.org>
- chokidar (file watcher): <https://github.com/paulmillr/chokidar>
- Tailscale MagicDNS docs: <https://tailscale.com/kb/1081/magicdns>
