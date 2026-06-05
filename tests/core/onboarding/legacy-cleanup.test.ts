/**
 * Tests for pre-0.2 antfly legacy-state detection + optional disk-reclaim.
 *
 * Real-fs strategy: ANTFLY_HOME points at a temp dir (old data dir lives at
 * $ANTFLY_HOME/data); the termite dir and brew-binary candidates are injected
 * overrides under the same sandbox. No module mocks beyond the standard
 * isolation set.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-antfly-legacy-${Date.now()}`)
const antflyHomeDir = join(testDir, 'antfly-home')
const oldDataDir = join(antflyHomeDir, 'data')
const termiteDir = join(testDir, 'termite')
const brewBinary = join(testDir, 'brew-antfly')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  detectLegacyState,
  runLegacyCleanup,
} from '../../../packages/adapter-antfly/src/legacy-cleanup'

const logger = { debug: mock(), info: mock(), warn: mock(), error: mock() }
const overrides = { termiteDir, brewBinaryCandidates: [brewBinary] }

function seedLegacyWorld(): void {
  mkdirSync(oldDataDir, { recursive: true })
  writeFileSync(join(oldDataDir, 'catalog.txt'), '[]')
  mkdirSync(join(termiteDir, 'models'), { recursive: true })
  writeFileSync(join(termiteDir, 'models', 'stub.onnx'), 'weights')
  writeFileSync(brewBinary, '#!/bin/sh\n', { mode: 0o755 })
}

function makeOpts(args: { interactive: boolean; answer?: boolean }) {
  const prompts: Array<{ prompt: string; defaultAnswer: boolean }> = []
  const opts = {
    interactive: args.interactive,
    autoApprove: !args.interactive,
    json: false,
    checkOnly: false,
    force: false,
    askYesNo: async (prompt: string, defaultAnswer: boolean) => {
      prompts.push({ prompt, defaultAnswer })
      return args.answer ?? false
    },
  }
  return { opts, prompts }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(antflyHomeDir, { recursive: true })
  process.env.ANTFLY_HOME = antflyHomeDir
})

afterEach(() => {
  delete process.env.ANTFLY_HOME
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('detectLegacyState', () => {
  it('returns nothing on a clean machine', async () => {
    expect(await detectLegacyState(overrides)).toEqual([])
  })

  it('finds the termite dir, old data dir, and brew binary', async () => {
    seedLegacyWorld()
    const findings = await detectLegacyState(overrides)
    expect(findings.map(f => f.kind).sort()).toEqual(['brew-binary', 'old-data-dir', 'termite-dir'])
    expect(findings.find(f => f.kind === 'old-data-dir')?.path).toBe(oldDataDir)
  })
})

describe('runLegacyCleanup', () => {
  it('deletes consented dirs but only ever suggests brew uninstall', async () => {
    seedLegacyWorld()
    const { opts, prompts } = makeOpts({ interactive: true, answer: true })

    const result = await runLegacyCleanup(opts, logger, overrides)

    expect(result.removed.sort()).toEqual([oldDataDir, termiteDir].sort())
    expect(existsSync(termiteDir)).toBe(false)
    expect(existsSync(oldDataDir)).toBe(false)
    // Brew binary is never deleted and never prompted for — suggestion only.
    expect(existsSync(brewBinary)).toBe(true)
    expect(prompts).toHaveLength(2)
    expect(result.notes.some(n => n.includes('brew uninstall antfly'))).toBe(true)
    expect(result.notes.some(n => n.includes('Bakin never runs brew'))).toBe(true)
  })

  it('prompts with default No and an ALL-antfly-data warning for the shared data dir', async () => {
    seedLegacyWorld()
    const { opts, prompts } = makeOpts({ interactive: true, answer: false })

    const result = await runLegacyCleanup(opts, logger, overrides)

    // Every deletion prompt defaults to No.
    expect(prompts.every(p => p.defaultAnswer === false)).toBe(true)
    const dataPrompt = prompts.find(p => p.prompt.includes('data'))
    expect(dataPrompt?.prompt).toContain('ALL antfly data on this machine')
    expect(dataPrompt?.prompt).toContain('backup/restore')

    // Declined: nothing removed, dirs intact.
    expect(result.removed).toEqual([])
    expect(existsSync(termiteDir)).toBe(true)
    expect(existsSync(oldDataDir)).toBe(true)
    expect(result.notes.filter(n => n.startsWith('Kept'))).toHaveLength(2)
  })

  it('never deletes under a non-interactive blanket --yes; reports instead', async () => {
    seedLegacyWorld()
    const { opts, prompts } = makeOpts({ interactive: false })

    const result = await runLegacyCleanup(opts, logger, overrides)

    expect(prompts).toHaveLength(0)
    expect(result.removed).toEqual([])
    expect(existsSync(termiteDir)).toBe(true)
    expect(existsSync(oldDataDir)).toBe(true)
    expect(result.notes.some(n => n.includes('Re-run `bakin install search` interactively'))).toBe(true)
  })

  it('is silent when there is nothing to clean', async () => {
    const { opts, prompts } = makeOpts({ interactive: true, answer: true })
    const result = await runLegacyCleanup(opts, logger, overrides)
    expect(result.findings).toEqual([])
    expect(result.notes).toEqual([])
    expect(prompts).toHaveLength(0)
  })
})
