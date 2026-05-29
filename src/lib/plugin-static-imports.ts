/**
 * Static import map for core plugins (#147 TG1).
 *
 * `bun build --compile` requires every plugin module to be statically
 * reachable from the entry point so it can trace + embed source bytes.
 * The plugin registry previously resolved core plugins via
 * `await import("../../plugins/team")` which Bun's compile step can't
 * follow. This module imports each built-in plugin by its exact config
 * path and exposes a synchronous lookup.
 *
 * Anything outside this list (user plugins under `~/.bakin/plugins/`)
 * still uses dynamic import at runtime, which is fine because user
 * plugins aren't embedded.
 *
 * Order of entries matches `bakin.config.ts`.
 */
import teamPlugin from '../../plugins/team'
import tasksPlugin from '../../plugins/tasks'
import memoryPlugin from '../../plugins/memory'
import modelsPlugin from '../../plugins/models'
import assetsPlugin from '../../plugins/assets'
import imagesPlugin from '../../plugins/images'
import workflowsPlugin from '../../plugins/workflows'
import schedulePlugin from '../../plugins/schedule'
import healthPlugin from '../../plugins/health'
import gitPlugin from '../../plugins/git'

import type { BakinPlugin } from '@bakin/core/plugin-types'

export const CORE_PLUGIN_IMPORTS: Readonly<Record<string, BakinPlugin>> = {
  'plugins/team': teamPlugin,
  'plugins/tasks': tasksPlugin,
  'plugins/memory': memoryPlugin,
  'plugins/models': modelsPlugin,
  'plugins/assets': assetsPlugin,
  'plugins/images': imagesPlugin,
  'plugins/workflows': workflowsPlugin,
  'plugins/schedule': schedulePlugin,
  'plugins/health': healthPlugin,
  'plugins/git': gitPlugin,
}
