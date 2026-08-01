#!/usr/bin/env bun

import { runCanonicalBrowsers } from './playwright-container'

if (import.meta.main) {
  runCanonicalBrowsers().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
