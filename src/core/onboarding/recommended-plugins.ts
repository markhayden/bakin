/**
 * Curated list of recommended plugins shown during `bakin onboard`
 * (Phase 6). Managed entirely in this file — there's no external data
 * source, the Bakin core team picks what to recommend.
 *
 * The list is **intentionally empty today.** Entries land here as the
 * extraction work in Phase 4-5 ships:
 *   - `messaging` — once `plugins/messaging/` is moved to
 *     `bakin-bits-official/plugins/messaging/` and tagged.
 *   - `projects` — same, after Phase 5.
 *
 * Adding an entry requires three things to be true:
 *   1. The plugin lives in a public github repo Bakin can clone.
 *   2. The `source` resolves cleanly via Bakin's #subpath syntax.
 *   3. The plugin's permissions are reasonable for first-run install
 *      (no `storage.write` to surprising locations, no `events.emit`
 *      that would spam the activity feed by default, etc).
 *
 * Updates here ship in a regular Bakin release — no separate
 * deploy / config service involved. Users on older Bakin versions
 * see the list that shipped with their binary; the recommended-plugins
 * component is a one-shot during onboarding so the list state at
 * marker-write time is what matters.
 */
import type { RecommendedPlugin } from './types'

export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  // Phase 4 will add:
  // {
  //   id: 'messaging',
  //   source: 'github:markhayden/bakin-bits-official#plugins/messaging',
  //   name: 'Messaging',
  //   description: 'Brainstorm, draft, schedule, and review content across channels.',
  //   defaultSelected: true,
  // },
  //
  // Phase 5 will add:
  // {
  //   id: 'projects',
  //   source: 'github:markhayden/bakin-bits-official#plugins/projects',
  //   name: 'Projects',
  //   description: 'Lightweight project tracker — markdown files in ~/.bakin/projects/.',
  //   defaultSelected: true,
  // },
] as const
