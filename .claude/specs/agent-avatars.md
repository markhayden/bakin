# Agent Avatar Management Spec

**Status:** Partial — thumbnails generated manually, automation pending for team plugin audit.

## Principle

Agent avatars are **per-installation content**, not source code. They belong in `~/.bakin/`, not in the repo. The repo must be installable on any machine — avatars are seeded on first run or uploaded via the team management UI.

## Storage Layout

```
~/.bakin/
  agents/
    {agent-id}/
      avatar.jpg          — 128px thumbnail (7-11KB), served via API
      avatar-full.png     — Original high-res source (preserved for re-generation)
```

**Naming convention:** Directory matches the agent's `id` field in `agents-data.ts`. Avatar files use fixed names (`avatar.jpg`, `avatar-full.png`) — no agent ID in the filename.

## Serving

Avatars are served via a Next.js API route, NOT as static files:

```
GET /api/agents/avatar?id={agentId}
```

- Reads `~/.bakin/agents/{id}/avatar.jpg`
- Returns `image/jpeg` with 1-hour cache, 24-hour stale-while-revalidate
- Returns 404 if no avatar exists (component falls back to initial + accent color)

The `headshot` field in `agents-data.ts` stores the API URL: `/api/agents/avatar?id={agentId}`

## Image Pipeline

When a new agent headshot is uploaded or generated:

1. **Source image** saved to `~/.bakin/agents/{id}/avatar-full.png`
2. **Thumbnail** generated via ffmpeg:
   ```bash
   ffmpeg -y -i ~/.bakin/agents/{id}/avatar-full.png -vf "scale=128:128" -q:v 2 ~/.bakin/agents/{id}/avatar.jpg
   ```
3. No repo changes needed — the API route serves from `~/.bakin/`

### Why 128px JPG?

- Largest avatar in the UI is `xl` at 64px (size-16 = 4rem). 128px = 2x for retina.
- JPG at quality 2 produces 7-11KB files.
- ffmpeg is already a project dependency (used by Rolo for video).

## Avatar Component

**File:** `src/components/agent-avatar.tsx`

### Sizes

| Size | Tailwind | Pixels | Use cases |
|------|----------|--------|-----------|
| `xs` | `size-5` | 20px | Asset cards, inline metadata |
| `sm` | `size-6` | 24px | Activity feed, task cards, workflow nodes |
| `md` | `size-8` | 32px | Default, general use |
| `lg` | `size-10` | 40px | Emphasized contexts |
| `xl` | `size-16` | 64px | Agent drawer header, edit form |

### Rendering Priority

1. `agent.headshot` image via `/api/agents/avatar?id={id}`
2. Fallback: first letter of agent name on accent-colored circle
3. Unknown agent: generic User icon

## Team Grid Card

`src/components/team/team-grid.tsx` uses a raw `<img>` for agent card hero images. This also uses `agent.headshot` which now points to the API route.

## Automation TODO (Team Plugin Audit)

When we reach the team/agents plugin in Phase 5B:

1. **Upload endpoint** — `POST /api/agents/avatar?id={agentId}` accepts image upload
2. **Auto-thumbnail** — Server-side ffmpeg generates 128px JPG on upload
3. **Crop UI** — Client-side canvas crop/resize before upload (square, face-centered)
4. **Validation** — Accept PNG/JPG/WebP source, reject >10MB, enforce square aspect
5. **Cache bust** — Append `&v={timestamp}` to headshot URL after upload
6. **Seeding** — `bakin init` should seed default avatars from a template pack if available

## What Changed (2026-03-30)

- Moved avatars from `public/headshots/` (static, in repo) to `~/.bakin/agents/{id}/` (runtime, per-install)
- Added `agents` path to `getBakinPaths()` and `initBakinHome()`
- Created `/api/agents/avatar` route to serve thumbnails from `~/.bakin/`
- Updated all `headshot` paths in `agents-data.ts` to use API route
- Removed `public/headshots/` from repo entirely
- Total avatar payload per request: ~7-11KB (128px JPG thumbnails)
