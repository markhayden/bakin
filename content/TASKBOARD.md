# Task Board
_Last updated: 03/19/2026, 10:45 MDT_

## 🔵 In Progress
- [ ] Create a recipe and full asset package for a healthy chicken and waffles dish @basil — 2026-03-19
  - Write the recipe copy (ingredients, steps, nutrition highlights, caption)
  - Brief and spawn @pixel to generate a photorealistic hero image of the dish
  - Assemble the full post package
  - When done, post results + image to Discord #general (channel id: 1483917792745885768)
  [2026-03-19 basil] Starting task — recipe copy is ready from earlier work. Spawning Pixel for hero image now.
  [2026-03-19 basil] Recipe copy already written this morning. Spawning Pixel for photorealistic hero image now.
  [2026-03-19 system] Dispatch failed: agent "basil" not found or unavailable
- [ ] Fix task log cross-contamination bug @patch — 2026-03-19
  Root cause: two separate code paths write to TASKBOARD.md — server.ts uses moveTaskInContent (raw string manipulation) and src/lib/taskboard.ts uses a proper parser/serializer. They race and corrupt each other. Fix: route all TASKBOARD.md writes through the taskboard.ts API. Remove moveTaskInContent from server.ts and replace with HTTP API calls to /api/tasks/move and /api/tasks/log.
  [2026-03-19 patch] Applying fix: replacing moveTaskInContent + writeFileSync in server.ts with HTTP API calls to /api/tasks/move and /api/tasks/assign. Removing dual-writer.

## 📋 Todo

## ✅ Done
- [x] Add agent detail drawer to Team page @patch — 2026-03-19
  - Drawer fully implemented — clicks agent card, opens Sheet with headshot, role def, model, should/shouldn't do, examples, tools, live heartbeat
  - Fixed SSE gap: heartbeat file changes now trigger re-fetch of /api/agents/health so Team page stays live
- [x] Theme today's recipe and content around chicken and waffles @basil — 2026-03-19
  - Crispy Baked Chicken & Protein Waffles: 52g protein, baked not fried, 35 min
  - Instagram + TikTok copy, asset briefs for Pixel (4 images) and Rolo (1 video)
  - Saved to content/posts/chicken-and-waffles/copy.md. Posted summary to #general
- [x] Generate persona headshots for all agents @pixel — 2026-03-19
  - All 5 painterly frontier-style headshots generated and wired into Mission Control Team page
  - roscoe.png, basil.png, pixel.png, rolo.png, patch.png → public/headshots/
- [x] Post "hello world" to #general in Discord @roscoe — 2026-03-19
  - Posted "hello world" to #general — pipeline test successful
- [x] Generate an image of a plate of tacos @pixel — 2026-03-18
- [x] **[3] Assemble + post to Discord** @roscoe — 2026-03-18
- [x] **[2] Generate recipe image** @pixel — 2026-03-18
- [x] **[1] Write recipe + post copy** @basil — 2026-03-18
- [x] Tell Mark a funny dad joke @roscoe — 2026-03-18
- [x] Generate cartoon Hawaiian sunset with capybara @pixel — 2026-03-18
- [x] Generate a cartoon image of a Hawaiian sunset @pixel — 2026-03-18
- [x] Create an image of a baby calf @pixel — 2026-03-18
- [x] create mc-daily-brief channel @roscoe — 2026-03-18
- [x] make a "hello world 2" post in discord @roscoe — 2026-03-18
- [x] Create Mission Control spec document @roscoe — 2026-03-18
- [x] Research Alex Finn Mission Control video @roscoe — 2026-03-18

## 🔴 Blocked
