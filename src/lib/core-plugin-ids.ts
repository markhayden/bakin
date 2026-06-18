/**
 * The canonical list of core plugin ids — the 10 plugins under `plugins/<id>/`.
 *
 * Single source of truth for the build/dev scripts that need to iterate the
 * core plugin set (`scripts/build-plugins.ts`, `scripts/dev.ts`). These lists
 * were previously hand-maintained copies in each script with DIFFERENT orderings;
 * when `images` was added it had to be threaded into every copy by hand and a
 * miss silently dropped a plugin from one build path. Owning the list once kills
 * that drift.
 *
 * This is a deliberately lightweight module (a plain string array, no imports)
 * so build scripts can pull the id list without loading the heavy
 * `CORE_PLUGIN_IMPORTS` map (which statically imports every plugin module).
 * An architecture test (`tests/architecture/core-plugin-ids.test.ts`) asserts
 * this list stays in lockstep with the keys of that map — the actual set the
 * binary embeds — so the two can never diverge.
 */
export const CORE_PLUGIN_IDS: readonly string[] = [
  'team',
  'tasks',
  'memory',
  'models',
  'assets',
  'images',
  'workflows',
  'schedule',
  'health',
  'git',
]
