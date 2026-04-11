/**
 * bakin_exec_get_paths — Get Bakin content directory paths.
 * System-level tool (stays in scripts, not plugin-specific).
 */
import { z } from 'zod'
import { getBakinPaths } from '../../src/core/content-dir'
import { addExecTool } from './registry'

addExecTool({
  name: 'bakin_exec_get_paths',
  label: 'Resolved paths',
  description: 'Get Bakin content directory paths — where to find assets, team info, docs, etc.',
  source: 'core',
  parameters: {},
  handler: async () => {
    const paths = getBakinPaths()
    return { ok: true, paths }
  },
})
