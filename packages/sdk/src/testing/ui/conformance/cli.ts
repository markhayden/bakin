#!/usr/bin/env bun

import { resolve } from 'node:path'

import { formatPluginUiFinding } from './contracts'
import { runPluginUiConformance } from './runner'

interface CliOptions {
  cwd?: string
  configPath?: string
  browserExecutablePath?: string
}

function usage(): string {
  return `Usage: bakin-plugin-test-ui [options]

Build and test one deterministic Bakin plugin UI fixture.

Options:
  --cwd <path>                 Plugin package root (default: current directory)
  --config <path>              Config module (default: bakin.ui-test.ts)
  --browser-executable <path>  Chromium executable override
  --help                       Show this help
`
}

function parseArgs(argv: string[]): CliOptions | 'help' {
  const options: CliOptions = {}
  const valueAfter = (index: number, option: string): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return 'help'
    if (arg === '--cwd') options.cwd = valueAfter(index, arg)
    else if (arg === '--config') options.configPath = valueAfter(index, arg)
    else if (arg === '--browser-executable') options.browserExecutablePath = valueAfter(index, arg)
    else throw new Error(`Unknown option: ${arg}`)
    index += 1
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options === 'help') {
    console.log(usage())
    return
  }
  const report = await runPluginUiConformance(options)
  const reportRoot = resolve(options.cwd ?? process.cwd(), report.reportDir)
  if (report.findings.length === 0) {
    console.log(`✓ ${report.pluginId} UI conformance passed`)
  } else {
    console.error(`✗ ${report.pluginId} UI conformance failed with ${report.findings.length} finding(s)`)
    for (const finding of report.findings) console.error(`  ${formatPluginUiFinding(finding)}`)
  }
  console.log(`Report: ${reportRoot}/index.html`)
  if (report.status === 'failed') process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
