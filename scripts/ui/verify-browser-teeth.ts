#!/usr/bin/env bun

import { resolve } from 'node:path'

import { runExpectedFailure } from './expected-failure'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const SEEDED_FAILURES = {
  'focus': 'toBeFocused',
  'keyboard': 'toHaveText',
  'overflow': 'toBeLessThanOrEqual',
  'console': 'Seeded Storybook console failure',
} as const

for (const [seededFailure, expectedSignature] of Object.entries(SEEDED_FAILURES)) {
  console.log(`Verifying browser ${seededFailure} failure...`)
  await runExpectedFailure({
    label: `Browser ${seededFailure}`,
    expectedSignature,
    command: ['bun', 'run', 'ui:test:browsers'],
    cwd: REPO_ROOT,
    env: {
      ...globalThis.process.env,
      BAKIN_UI_BROWSER_PROJECT: 'chromium',
      VITE_BAKIN_UI_STORY_SEED_FAILURE: seededFailure,
    },
  })
}

console.log('Browser teeth caught seeded focus, keyboard, overflow, and console failures.')
