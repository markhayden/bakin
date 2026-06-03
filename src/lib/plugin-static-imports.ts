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

import teamManifestJson from '../../plugins/team/bakin-plugin.json'
import tasksManifestJson from '../../plugins/tasks/bakin-plugin.json'
import memoryManifestJson from '../../plugins/memory/bakin-plugin.json'
import modelsManifestJson from '../../plugins/models/bakin-plugin.json'
import assetsManifestJson from '../../plugins/assets/bakin-plugin.json'
import imagesManifestJson from '../../plugins/images/bakin-plugin.json'
import workflowsManifestJson from '../../plugins/workflows/bakin-plugin.json'
import scheduleManifestJson from '../../plugins/schedule/bakin-plugin.json'
import healthManifestJson from '../../plugins/health/bakin-plugin.json'
import gitManifestJson from '../../plugins/git/bakin-plugin.json'

import { readPluginManifestJson } from '../../packages/core/src/plugins/manifest'
import type { CorePluginRegistration } from './plugin-registry'
import type { BakinPlugin } from '@bakin/core/plugin-types'

function corePlugin(plugin: BakinPlugin, manifestJson: unknown): CorePluginRegistration {
  return {
    plugin,
    manifest: readPluginManifestJson(JSON.stringify(manifestJson)),
  }
}

export const CORE_PLUGIN_IMPORTS: Readonly<Record<string, CorePluginRegistration>> = {
  'plugins/team': corePlugin(teamPlugin, teamManifestJson),
  'plugins/tasks': corePlugin(tasksPlugin, tasksManifestJson),
  'plugins/memory': corePlugin(memoryPlugin, memoryManifestJson),
  'plugins/models': corePlugin(modelsPlugin, modelsManifestJson),
  'plugins/assets': corePlugin(assetsPlugin, assetsManifestJson),
  'plugins/images': corePlugin(imagesPlugin, imagesManifestJson),
  'plugins/workflows': corePlugin(workflowsPlugin, workflowsManifestJson),
  'plugins/schedule': corePlugin(schedulePlugin, scheduleManifestJson),
  'plugins/health': corePlugin(healthPlugin, healthManifestJson),
  'plugins/git': corePlugin(gitPlugin, gitManifestJson),
}
