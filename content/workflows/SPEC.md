# Workflows Plugin — Full Spec
_Created: 2026-03-20 | Owner: Mark + Roscoe | Builder: Patch_

---

## Overview

The Workflows plugin transforms Mission Control from a task tracker into a full
production orchestration system. Workflows define multi-step, multi-agent
pipelines with human approval gates. Agents execute their assigned steps, the
workflow engine advances state, and Mark approves or rejects at defined gates —
all from the Mission Control UI or Discord.

**Key principle:** The workflow is the source of truth. Agents are workers.
Tasks can optionally belong to a workflow, in which case they follow the
workflow's rules rather than ad-hoc assignment.

---

## Navigation

Add **"Workflows"** to the Mission Control nav (between Tasks and Calendar):

```
🗂️ Tasks
⚡ Workflows    ← new
📅 Calendar
📁 Projects
🧠 Memory
📚 Docs
👥 Team
🏢 Office
```

---

## Core Concepts

### Workflow Definition
A YAML file in `content/workflows/definitions/` that describes the full
pipeline: steps, agents, gates, parallel branches, and outputs.

### Workflow Execution (Run)
A live instance of a workflow definition. Has its own state, step progress,
and context (data passed between steps). Stored in
`content/workflows/runs/{run-id}/state.json`.

### Gate
A human approval checkpoint. The workflow pauses here until Mark approves
or rejects. On reject, the workflow routes back to a specified step.

### Step Context
Data passed between steps — script files, image paths, video paths, captions.
Each step declares its inputs and outputs. The engine wires them together.

---

## Directory Structure

```
content/workflows/
├── definitions/
│   ├── content-creation.yaml       ← template: full content pipeline
│   ├── image-only.yaml             ← template: image generation + approval
│   ├── video-reel.yaml             ← template: video with audio + approval
│   └── quick-post.yaml             ← template: no approval, direct publish
├── runs/
│   └── {run-id}/
│       ├── state.json              ← live execution state
│       ├── context.json            ← data flowing between steps
│       └── log.jsonl               ← step-by-step audit trail
└── SPEC.md                         ← this file
```

```
plugins/workflows/
├── index.ts                        ← plugin entry point
├── engine.ts                       ← workflow execution engine
├── types.ts                        ← TypeScript types
├── parser.ts                       ← YAML definition parser
├── client.tsx                      ← React client entry
├── components/
│   ├── workflows-page.tsx          ← main page component
│   ├── workflow-canvas.tsx         ← React Flow canvas
│   ├── nodes/
│   │   ├── agent-node.tsx          ← agent step node
│   │   ├── gate-node.tsx           ← approval gate node
│   │   ├── parallel-node.tsx       ← parallel execution group
│   │   ├── trigger-node.tsx        ← input/trigger node
│   │   └── output-node.tsx         ← publish/output node
│   ├── workflow-list.tsx           ← sidebar list of runs
│   ├── run-detail.tsx              ← selected run detail panel
│   └── gate-modal.tsx              ← approval modal
└── api/
    ├── list/route.ts               ← GET /api/workflows
    ├── definitions/route.ts        ← GET /api/workflows/definitions
    ├── run/route.ts                ← POST /api/workflows/run
    ├── [id]/
    │   ├── state/route.ts          ← GET /api/workflows/{id}/state
    │   ├── steps/
    │   │   └── [step]/
    │   │       └── complete/route.ts ← POST .../complete
    │   └── gates/
    │       └── [step]/
    │           └── route.ts        ← POST .../approve | reject
```

---

## Workflow Definition Format (YAML)

```yaml
name: Content Creation
description: Full pipeline from brief to published post
version: 1

# Input schema — what's needed to start this workflow
inputs:
  brief:
    type: string
    description: "Content brief or topic"
  schedule_time:
    type: string
    description: "ISO timestamp to schedule post (optional)"
    required: false

steps:
  # ── Step 1: Script & Copy ────────────────────────────────────────────
  - id: script
    type: agent
    label: "✍️ Write Script"
    agent: basil
    task: |
      Write a complete content package for: {input.brief}
      Include: recipe/tip copy, Instagram caption, voiceover script (15-20s)
      Save to: content/posts/{run_id}/copy.md
    outputs:
      - id: copy_file
        path: "content/posts/{run_id}/copy.md"
      - id: caption
        type: string
      - id: voiceover_script
        type: string

  # ── Gate 1: Script Approval ──────────────────────────────────────────
  - id: script_gate
    type: gate
    label: "🚦 Approve Script"
    description: "Review Basil's copy before generating assets"
    notify:
      - channel: discord
        target: "#general"
    preview:
      - "{outputs.script.copy_file}"
    on_approve: assets
    on_reject:
      goto: script
      note_to_agent: true   # sends Mark's rejection note to Basil

  # ── Step 2: Asset Generation (parallel) ─────────────────────────────
  - id: assets
    type: parallel
    label: "🎨 Generate Assets"
    steps:
      - id: hero_image
        type: agent
        label: "🖼️ Hero Image"
        agent: pixel
        task: |
          Generate a photorealistic hero image for: {input.brief}
          Reference copy: {outputs.script.copy_file}
          Save to: content/assets/{run_id}-hero.png
        outputs:
          - id: image_file
            path: "content/assets/{run_id}-hero.png"

      - id: video
        type: agent
        label: "🎬 Video + Audio"
        agent: rolo
        task: |
          Generate a 10-15 second cinematic video for: {input.brief}
          Voiceover script: {outputs.script.voiceover_script}
          Use ElevenLabs for voiceover + background music.
          Save to: content/assets/video/{run_id}-reel.mp4
        outputs:
          - id: video_file
            path: "content/assets/video/{run_id}-reel.mp4"

  # ── Gate 2: Final Approval ───────────────────────────────────────────
  - id: final_gate
    type: gate
    label: "🚦 Approve Final Post"
    description: "Review assembled post before publishing"
    notify:
      - channel: discord
        target: "#general"
    preview:
      - "{outputs.assets.hero_image.image_file}"
      - "{outputs.assets.video.video_file}"
      - caption: "{outputs.script.caption}"
    on_approve: publish
    on_reject:
      goto: assets
      note_to_agent: true

  # ── Step 3: Publish ──────────────────────────────────────────────────
  - id: publish
    type: output
    label: "📤 Publish"
    channels:
      - discord:#general
      # future: instagram, tiktok, twitter
    content:
      video: "{outputs.assets.video.video_file}"
      image: "{outputs.assets.hero_image.image_file}"
      caption: "{outputs.script.caption}"
    schedule: "{input.schedule_time}"
```

---

## Workflow Run State (JSON)

```json
{
  "run_id": "wf_abc123",
  "definition": "content-creation",
  "status": "waiting_gate",
  "current_step": "script_gate",
  "started_at": "2026-03-20T17:00:00Z",
  "updated_at": "2026-03-20T17:08:00Z",
  "input": {
    "brief": "Healthy kale salad tip",
    "schedule_time": null
  },
  "steps": {
    "script": {
      "status": "complete",
      "started_at": "2026-03-20T17:00:10Z",
      "completed_at": "2026-03-20T17:07:45Z",
      "agent": "basil",
      "outputs": {
        "copy_file": "content/posts/wf_abc123/copy.md",
        "caption": "Kale is king 👑...",
        "voiceover_script": "Did you know one cup of kale..."
      }
    },
    "script_gate": {
      "status": "waiting",
      "notified_at": "2026-03-20T17:07:46Z",
      "discord_message_id": "1484695923580866662"
    },
    "assets": { "status": "pending" },
    "final_gate": { "status": "pending" },
    "publish": { "status": "pending" }
  }
}
```

---

## Task ↔ Workflow Integration

Tasks in TASKBOARD.md can optionally reference a workflow:

```markdown
- [ ] Kale healthy eating tip @basil — 2026-03-20
  workflow: content-creation
  run_id: wf_abc123
  step: script
```

When a task has a `workflow` and `step` field:
- The agent knows to follow workflow rules (write outputs to context, call complete endpoint)
- The task board shows a workflow badge on the card: `⚡ content-creation`
- Clicking the badge navigates to the workflow run in the Workflows page

Tasks without a workflow field work exactly as they do today — no breaking changes.

---

## React Flow Canvas

### Node Types

**TriggerNode** (input):
```
┌───────────────────────┐
│ 📥 TRIGGER            │
│ "Kale tip post"       │
│ started: 17:00        │
└───────────────────────┘
```

**AgentNode**:
```
┌───────────────────────┐
│ 🌿 BASIL              │
│ Write Script          │
│ ● running  2m 14s     │
│ tokens: 847           │
│ [logs] [steer] [stop] │
└───────────────────────┘
```

**GateNode** (pulsing animation when waiting):
```
┌───────────────────────┐
│ 🚦 APPROVAL GATE      │  ← yellow pulse border
│ Approve Script        │
│ ⏳ waiting for Mark   │
│ [✅ Approve] [✏️ Edit]│
│ [❌ Reject]           │
└───────────────────────┘
```

**ParallelNode** (container):
```
┌─────────────────────────────────┐
│ ⚡ PARALLEL                     │
│ ┌──────────────┐ ┌────────────┐ │
│ │ 🖼️ Pixel    │ │ 🎬 Rolo   │ │
│ │ Hero Image  │ │ Video+Aud │ │
│ │ ✅ complete │ │ 🔄 running│ │
│ └──────────────┘ └────────────┘ │
└─────────────────────────────────┘
```

**OutputNode**:
```
┌───────────────────────┐
│ 📤 PUBLISH            │
│ discord:#general      │
│ instagram (future)    │
│ ⏳ pending            │
└───────────────────────┘
```

### Edge Labels
Edges between nodes show what data is flowing:
```
[Basil] ──"copy.md, caption, voiceover"──▶ [Gate]
[Gate]  ──"approved"──▶ [Parallel]
[Pixel] ──"hero.png"──▶ [Final Gate]
[Rolo]  ──"reel.mp4"──▶ [Final Gate]
```

---

## Approval Flow — Discord Integration

When a workflow hits a gate, Roscoe posts to Discord:

```
🚦 APPROVAL REQUIRED — Content Creation (step 2/5)
Run: wf_abc123

Basil's script for "Kale tip":
> "Kale is one of the most nutrient-dense foods on the planet..."
> Caption: "Kale is king 👑 Here's why..."

React ✅ to approve, ❌ to reject, ✏️ to request changes
```

Mark reacts → Roscoe reads reaction via Discord event → calls
`POST /api/workflows/wf_abc123/gates/script_gate/approve` (or reject)
→ workflow advances automatically.

---

## Workflows Page UI Layout

```
╔═══════════════════════════════════════════════════════════╗
║  ⚡ Workflows                    [+ New Run] [Templates]  ║
╠══════════════╦════════════════════════════════════════════╣
║  RUNS        ║  content-creation — "Kale tip"            ║
║              ║  run: wf_abc123  started: 17:00            ║
║  ● wf_abc123 ║  status: 🚦 Waiting gate (step 2/5)       ║
║  🚦 waiting  ╠════════════════════════════════════════════╣
║              ║                                            ║
║  ○ wf_ab111  ║      [React Flow Canvas]                   ║
║  ✅ complete  ║                                            ║
║              ║   📥 ──▶ 🌿Basil ──▶ 🚦GATE ──▶ ...        ║
║  ○ wf_ab099  ║              ✅          ⏳                  ║
║  ✅ complete  ║                                            ║
║              ║   [gate approval panel slides in]          ║
║  [Templates] ║                                            ║
║  ─────────── ║                                            ║
║  content-    ╚════════════════════════════════════════════╣
║  creation    ║  STEP LOG                                  ║
║  image-only  ║  17:00:10 ▶ Script step started (Basil)   ║
║  video-reel  ║  17:07:45 ✅ Script step complete          ║
║  quick-post  ║  17:07:46 🚦 Gate notified via Discord     ║
╚══════════════╩════════════════════════════════════════════╝
```

---

## Agent Rules (AGENTS.md additions)

Each agent gets this rule added to their AGENTS.md:

```markdown
## Workflow Steps

When a task includes `workflow:` and `step:` fields:
1. Check content/workflows/runs/{run_id}/state.json for your step inputs
2. Execute your task using those inputs
3. Write outputs to content/workflows/runs/{run_id}/context.json
4. Call POST /api/workflows/{run_id}/steps/{step_id}/complete with your outputs
5. Do NOT advance the workflow yourself — the engine handles routing
6. If you need to flag a problem, call the complete endpoint with status: "failed"
   and include an error message — the engine will notify Roscoe

When a task does NOT include workflow fields: work as normal.
```

---

## API Endpoints

```
GET  /api/workflows                          list all runs
GET  /api/workflows/definitions              list available templates
POST /api/workflows/run                      start a new run
  body: { definition: "content-creation", input: { brief: "..." } }

GET  /api/workflows/:id/state                get run state + context
POST /api/workflows/:id/steps/:step/complete advance a step
  body: { status: "complete"|"failed", outputs: {...}, error?: "..." }

POST /api/workflows/:id/gates/:step/approve  approve a gate
  body: { note?: "looks good" }
POST /api/workflows/:id/gates/:step/reject   reject a gate
  body: { note: "change the tone to be less formal" }

SSE  /api/workflows/:id/events               live state stream
```

---

## Build Phases

### Phase 1 — Engine + Basic UI (MVP)
- [ ] YAML parser for workflow definitions
- [ ] Workflow engine (state machine: pending → running → waiting_gate → complete)
- [ ] File-based state store (content/workflows/runs/)
- [ ] API endpoints (run, complete, approve, reject, state)
- [ ] Workflows nav item + basic list page
- [ ] React Flow canvas with static layout (auto-layout from definition)
- [ ] Gate modal (approve/reject in UI)
- [ ] 3 starter templates: content-creation, image-only, quick-post
- [ ] Task ↔ workflow link (workflow/step fields in TASKBOARD.md)
- [ ] Workflow badge on task cards

### Phase 2 — Discord Approval
- [ ] Roscoe posts gate notifications to Discord with preview
- [ ] Reaction listener (✅/❌) → auto-approve/reject via API
- [ ] Rejection notes forwarded to relevant agent

### Phase 3 — Visual Workflow Builder
- [ ] Drag-and-drop node editor to build custom workflows
- [ ] Save custom definitions to content/workflows/definitions/
- [ ] Template library (clone and customize)

---

## Built-in Templates (Starter Set)

| Template | Steps | Gates | Use Case |
|---|---|---|---|
| `content-creation` | 5 | 2 | Full pipeline: script → assets → publish |
| `image-only` | 3 | 1 | Brief → Pixel hero image → approve → post |
| `video-reel` | 4 | 1 | Brief → Rolo video + audio → approve → post |
| `quick-post` | 2 | 0 | Brief → Basil copy → auto-post (no approval) |
| `recipe-full` | 6 | 2 | Full recipe: copy + hero + video + carousel → post |

---

## Open Questions

- Gate notifications in Discord: post to #general or a dedicated #mc-approvals channel?
- Should workflow runs auto-expire after N days?
- Can Mark start a workflow run directly from Discord? ("@Roscoe run content-creation for kale tip")
- Scheduling: integrate with CALENDAR.md for publish_at times?
