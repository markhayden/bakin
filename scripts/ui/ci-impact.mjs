#!/usr/bin/env node

import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const NON_UI_PATHS = [
  /^\.claude\//,
  /^\.agents\//,
  /^docs\//,
  /^scripts\/docs\//,
  /^tests\/docs\//,
  /^tasks\//,
  /^(?:CHANGELOG|CONTRIBUTING|LICENSE|README)(?:\.[^/]*)?$/,
]

function isKnownNonUiPath(path) {
  const portablePath = path.replaceAll('\\', '/')
  return NON_UI_PATHS.some((pattern) => pattern.test(portablePath))
}

export function classifyUiImpact(changedFiles) {
  if (changedFiles.length === 0) return { runUi: true, reason: 'empty-change-set' }
  if (changedFiles.every(isKnownNonUiPath)) return { runUi: false, reason: 'docs-or-planning-only' }
  return { runUi: true, reason: 'ui-or-uncertain-impact' }
}

function changedFilesBetween(baseSha, headSha) {
  if (!baseSha || !headSha) throw new Error('BAKIN_UI_BASE_SHA and BAKIN_UI_HEAD_SHA are required')
  const result = spawnSync('git', ['diff', '--name-only', '-z', `${baseSha}...${headSha}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git diff failed with exit code ${result.status}: ${result.stderr.trim()}`)
  }
  return result.stdout.split('\0').filter(Boolean)
}

function main() {
  const changedFiles = changedFilesBetween(
    process.env.BAKIN_UI_BASE_SHA,
    process.env.BAKIN_UI_HEAD_SHA,
  )
  const impact = classifyUiImpact(changedFiles)
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required')

  appendFileSync(outputPath, `run_ui=${impact.runUi}\nreason=${impact.reason}\n`)
  console.log(`UI impact: ${impact.runUi ? 'run full suite' : 'skip suite'} (${impact.reason}; ${changedFiles.length} files)`)
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
