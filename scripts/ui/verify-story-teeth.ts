#!/usr/bin/env bun

import { resolve } from 'node:path'

import { runExpectedFailure } from './expected-failure'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const SEEDED_FAILURES = {
  'axe': 'button-name',
  'focus': 'toHaveFocus',
  'keyboard': 'toHaveTextContent',
  'overflow': 'toBeLessThanOrEqual',
} as const

for (const [seededFailure, expectedSignature] of Object.entries(SEEDED_FAILURES)) {
  console.log(`Verifying Storybook ${seededFailure} failure...`)
  await runExpectedFailure({
    label: `Storybook ${seededFailure}`,
    expectedSignature,
    command: ['bun', 'run', 'ui:test:stories'],
    cwd: REPO_ROOT,
    env: {
      ...globalThis.process.env,
      VITE_BAKIN_UI_STORY_SEED_FAILURE: seededFailure,
    },
  })
}

console.log('Storybook teeth caught seeded axe, focus, keyboard, and overflow failures.')
