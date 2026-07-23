import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CORE_PLUGIN_UI_ENROLLMENT,
  validateCorePluginUiEnrollment,
} from '../../../scripts/ui/verify-plugin-conformance'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('official core plugin UI conformance enrollment', () => {
  it('names every current client package and explicitly classifies server-only plugins', () => {
    expect(validateCorePluginUiEnrollment()).toEqual([])
    expect(CORE_PLUGIN_UI_ENROLLMENT.filter((entry) => entry.status === 'server-only').map((entry) => entry.id)).toEqual([
      'git',
      'images',
    ])
  })

  it('blocks silent additions and false server-only classifications', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-plugin-ui-enrollment-'))
    roots.push(root)
    mkdirSync(join(root, 'plugins/new-plugin'), { recursive: true })
    writeFileSync(join(root, 'plugins/new-plugin/bakin-plugin.json'), JSON.stringify({ id: 'new-plugin' }))
    writeFileSync(join(root, 'plugins/new-plugin/client.tsx'), 'export {}\n')

    expect(validateCorePluginUiEnrollment(root, [])).toContain(
      'plugins/new-plugin is missing from official plugin UI enrollment',
    )
    expect(validateCorePluginUiEnrollment(root, [{
      id: 'new-plugin',
      root: 'plugins/new-plugin',
      status: 'server-only',
      reason: 'Incorrect seeded classification.',
    }])).toContain('new-plugin is labeled server-only but has a browser client entrypoint')
  })
})
