/**
 * Architecture scan guarding the canonical core-plugin id list
 * (src/lib/core-plugin-ids.ts) against drift.
 *
 * The build/dev scripts (scripts/build-plugins.ts, scripts/dev.ts) used to
 * each carry a hand-maintained copy of this list in a different order; adding
 * `images` had to be threaded into every copy and a miss silently dropped a
 * plugin from one build path. They now all import CORE_PLUGIN_IDS — but a
 * single source is only safe if it can't silently fall out of sync with the
 * two things that define the REAL core set:
 *   1. the plugin directories on disk under plugins/
 *   2. the keys of CORE_PLUGIN_IMPORTS (src/lib/plugin-static-imports.ts) — the
 *      map the binary statically imports + embeds.
 * This test fails if any of the three diverge.
 *
 * Pure scanner: imports the zero-dependency CORE_PLUGIN_IDS list and reads the
 * other two sources as text/dir — imports no heavy app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { CORE_PLUGIN_IDS } from '../../src/lib/core-plugin-ids'

const ROOT = process.cwd()
const sorted = (xs: readonly string[]) => [...xs].sort()

describe('canonical core-plugin id list', () => {
  it('matches the plugin directories on disk under plugins/', () => {
    const dirs = readdirSync(join(ROOT, 'plugins')).filter((name) =>
      statSync(join(ROOT, 'plugins', name)).isDirectory(),
    )
    expect(sorted(CORE_PLUGIN_IDS)).toEqual(sorted(dirs))
  })

  it('matches the keys of CORE_PLUGIN_IMPORTS (the embedded set)', () => {
    // Parse the source for `'plugins/<id>':` keys rather than importing the map,
    // which would statically pull in every plugin module.
    const src = readFileSync(join(ROOT, 'src/lib/plugin-static-imports.ts'), 'utf-8')
    const keys = [...src.matchAll(/['"]plugins\/([a-z0-9-]+)['"]\s*:/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    expect(sorted(CORE_PLUGIN_IDS)).toEqual(sorted(keys))
  })
})
