/**
 * Freshness-check tie handling (audit follow-up FW1.7): a source install's
 * cpSync stamps source and any shipped dist/ with ~identical mtimes. A tie
 * treated as "fresh" would execute shipped dist bytes that were never
 * rebuilt from validated source. The check is strictly-newer: ties rebuild.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-builder-freshness-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'

const pluginDir = join(testDir, 'plugins', 'tie-test')
const ATTACKER_DIST = '// ATTACKER BYTES — must never survive a tie\n'

beforeAll(() => {
  mkdirSync(join(pluginDir, 'dist'), { recursive: true })
  writeFileSync(join(pluginDir, 'index.ts'), [
    'const plugin = {',
    "  id: 'tie-test',",
    "  name: 'Tie Test',",
    '  activate() {},',
    '}',
    'export default plugin',
    '',
  ].join('\n'))
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
    name: 'tie-test', version: '0.0.1',
  }))
  writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify({
    id: 'tie-test', name: 'Tie Test', version: '0.0.1',
  }))
  writeFileSync(join(pluginDir, 'client.tsx'), "import './domain.css'\n")
  writeFileSync(join(pluginDir, 'domain.css'), '.fresh-card{display:grid}\n')
  writeFileSync(join(pluginDir, 'dist', 'index.js'), ATTACKER_DIST)
  writeFileSync(join(pluginDir, 'dist', 'client.js'), '// ATTACKER CLIENT BYTES\n')
  writeFileSync(join(pluginDir, 'dist', 'client.css'), '.fresh-card{display:block}\n')

  // The cpSync shape: every file carries the same mtime.
  const tie = new Date('2026-01-01T00:00:00.000Z')
  for (const rel of [
    'index.ts', 'client.tsx', 'domain.css', 'package.json', 'bakin-plugin.json',
    join('dist', 'index.js'), join('dist', 'client.js'), join('dist', 'client.css'),
  ]) {
    utimesSync(join(pluginDir, rel), tie, tie)
  }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('user-plugin-builder freshness tie', () => {
  it('an mtime tie between dist and source REBUILDS — shipped dist bytes do not survive', async () => {
    await buildUserPlugin(pluginDir)
    const dist = readFileSync(join(pluginDir, 'dist', 'index.js'), 'utf-8')
    expect(dist).not.toContain('ATTACKER BYTES')
    expect(dist).toContain('tie-test')
    expect(readFileSync(join(pluginDir, 'dist', 'client.css'), 'utf-8')).toContain(
      ':where([data-bakin-plugin="tie-test"]) .fresh-card',
    )
  })

  it('a strictly-newer dist is fresh and skips the rebuild', async () => {
    // Make dist strictly newer than every source file, then plant a sentinel.
    writeFileSync(join(pluginDir, 'dist', 'index.js'), '// SENTINEL fresh dist for tie-test\n')
    writeFileSync(join(pluginDir, 'dist', 'client.css'), '.fresh-card{display:flex}\n')
    const older = new Date('2026-01-01T00:00:00.000Z')
    const newer = new Date('2026-01-02T00:00:00.000Z')
    for (const rel of ['index.ts', 'client.tsx', 'domain.css', 'package.json', 'bakin-plugin.json']) {
      utimesSync(join(pluginDir, rel), older, older)
    }
    utimesSync(join(pluginDir, 'dist', 'index.js'), newer, newer)
    utimesSync(join(pluginDir, 'dist', 'client.js'), newer, newer)

    await buildUserPlugin(pluginDir)
    expect(readFileSync(join(pluginDir, 'dist', 'index.js'), 'utf-8')).toContain('SENTINEL')
    expect(readFileSync(join(pluginDir, 'dist', 'client.css'), 'utf-8')).toContain(
      ':where([data-bakin-plugin="tie-test"]) .fresh-card',
    )
  })
})
