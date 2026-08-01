#!/usr/bin/env bun

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../..')

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit(root)
  return files
}

async function main(): Promise<void> {
  const process = Bun.spawn(['bun', 'run', 'ui:test:visual'], {
    cwd: REPO_ROOT,
    env: { ...globalThis.process.env, BAKIN_UI_VISUAL_SEED_DIFF: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode === 0) throw new Error('Visual teeth test unexpectedly passed after the seeded visual change')

  const resultFiles = walkFiles(join(REPO_ROOT, 'test-results/ui-visual'))
  const required = ['-actual.png', '-expected.png', '-diff.png', 'trace.zip']
  for (const suffix of required) {
    if (!resultFiles.some((path) => path.endsWith(suffix))) {
      throw new Error(`Visual teeth test did not produce ${suffix}`)
    }
  }
  if (!existsSync(join(REPO_ROOT, 'playwright-report/ui/index.html'))) {
    throw new Error('Visual teeth test did not produce the Playwright HTML report')
  }
  console.log('Visual teeth test blocked the seeded change and produced HTML, trace, expected, actual, and diff artifacts.')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
