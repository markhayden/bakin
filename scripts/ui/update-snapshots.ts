#!/usr/bin/env bun

import { runCanonicalVisual } from './playwright-container'

if (import.meta.main) {
  runCanonicalVisual('update').catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
