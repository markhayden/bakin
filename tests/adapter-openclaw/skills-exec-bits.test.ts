/**
 * Pin: OpenClaw's skills.write sets the executable bit on projected scripts
 * (shebang or script extension). Hub bundles ship real shell/python scripts
 * that agents invoke as `./scripts/foo.sh` — text-mode projection alone
 * ships them broken.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-oc-skill-exec-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { rmSync, statSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))

import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('openclaw skills exec bits', () => {
  it('projects scripts executable and plain files not', async () => {
    const runtime = createOpenClawRuntimeAdapter()
    await runtime.skills.write({
      name: 'exec-test',
      instructions: '# exec test',
      files: {
        'SKILL.md': '# exec test',
        'scripts/go.sh': '#!/bin/sh\necho go\n',
        'tool': '#!/usr/bin/env python3\nprint(1)\n',
        'notes.md': 'not a script',
      },
    })
    const dir = pathJoin(testDir, 'openclaw', 'skills', 'exec-test')
    expect(statSync(pathJoin(dir, 'scripts', 'go.sh')).mode & 0o111).not.toBe(0)
    expect(statSync(pathJoin(dir, 'tool')).mode & 0o111).not.toBe(0)
    expect(statSync(pathJoin(dir, 'notes.md')).mode & 0o111).toBe(0)
  })
})
