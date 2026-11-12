/**
 * The declared requirements of the REAL components (spec §4): every
 * requirement names a component that runs earlier, and the table is the
 * one the spec fixes.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-onboarding-requirements-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), settings: join(testDir, 'settings.json') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { COMPONENT_ORDER } from '../../../src/core/onboarding/index'

describe('onboarding component requirements', () => {
  test('every requirement names a component that runs earlier', () => {
    const seen = new Set<string>()
    for (const component of COMPONENT_ORDER) {
      for (const required of component.requires) {
        expect({ component: component.name, requires: required, earlier: seen.has(required) })
          .toEqual({ component: component.name, requires: required, earlier: true })
      }
      seen.add(component.name)
    }
  })

  test('the table is the one the spec fixes', () => {
    expect(Object.fromEntries(COMPONENT_ORDER.map((component) => [component.name, [...component.requires]]))).toEqual({
      mkdir: [],
      settings: ['mkdir'],
      runtime: ['settings'],
      search: ['settings'],
      'search-models': ['search'],
      media: ['mkdir'],
      'openclaw-integration': ['runtime'],
      'plugin-assets': ['runtime'],
      'agent-sync': ['runtime'],
      llm: ['runtime'],
      models: ['runtime'],
      budget: ['settings'],
      channels: ['runtime'],
      'recommended-plugins': ['runtime'],
      'recommended-agents': ['runtime'],
      capabilities: ['runtime'],
    })
  })

  test('only the home and the settings file are usable before they exist', () => {
    expect(COMPONENT_ORDER.filter((component) => component.usableWhenMissing).map((component) => component.name)).toEqual(['mkdir', 'settings'])
  })
})
