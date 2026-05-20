import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-manifest-embedded-'))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@bakin/core/plugins/lockfile', () => ({
  readPluginLockfile: () => ({ version: 1, plugins: {} }),
}))

mock.module('@/core/plugins/upgrade', () => ({
  runChecks: async () => [],
}))

mock.module('@/lib/plugin-registry', () => ({
  isCorePlugin: (id: string) => id === 'tasks',
  pluginRegistry: {
    getRegistrySnapshot: () => [{
      id: 'tasks',
      name: 'Tasks',
      version: '1.0.0',
      status: 'active',
      contributes: {},
    }],
  },
}))

import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'
import { get } from '../../packages/host/src/api/plugins/manifest'

const originalBunFile = Bun.file
const originalCwd = process.cwd()

describe('plugin manifest embedded assets', () => {
  afterEach(() => {
    Bun.file = originalBunFile
    setEmbeddedAssets(new Map())
    process.chdir(originalCwd)
    rmSync(testDir, { recursive: true, force: true })
  })

  it('advertises core plugin clients that only exist in the embedded binary asset map', async () => {
    const cwdWithoutRepoFallback = mkdtempSync(join(tmpdir(), 'bakin-manifest-no-repo-'))
    process.chdir(cwdWithoutRepoFallback)
    setEmbeddedAssets(new Map([
      ['/api/plugins/tasks/assets/client.js', '/$bunfs/tasks-client.js'],
    ]))
    Bun.file = ((path: string) => ({
      exists: async () => path === '/$bunfs/tasks-client.js',
    })) as unknown as typeof Bun.file

    const res = await get(new Request('http://localhost/api/plugins/manifest'))
    const body = await res.json() as {
      plugins: Array<{ id: string; clientEntry?: string; clientVersion?: string }>
    }

    expect(body.plugins[0]?.id).toBe('tasks')
    expect(body.plugins[0]?.clientEntry).toBe('/api/plugins/tasks/assets/client.js')
    expect(body.plugins[0]?.clientVersion?.startsWith('embedded-')).toBe(true)

    rmSync(cwdWithoutRepoFallback, { recursive: true, force: true })
  })
})
