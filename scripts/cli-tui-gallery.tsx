#!/usr/bin/env bun
import { GALLERY_SCREENS, isGalleryScreen, renderGalleryScreen, type GalleryScreen } from '../src/core/cli/ui/tui-gallery'

function printUsage(): void {
  console.log('Usage: bun run cli:tui-gallery [screen] [--columns <n>]')
  console.log('')
  console.log('Screens:')
  console.log(`  all`)
  for (const screen of GALLERY_SCREENS) console.log(`  ${screen}`)
}

function parseArgs(argv: string[]): { screen: GalleryScreen; columns: number; list: boolean } {
  let screen: GalleryScreen = 'all'
  let columns = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100
  let list = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--list') {
      list = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--columns') {
      const raw = argv[++i]
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 40) {
        throw new Error('--columns must be an integer >= 40')
      }
      columns = parsed
      continue
    }
    if (arg.startsWith('--columns=')) {
      const parsed = Number(arg.slice('--columns='.length))
      if (!Number.isInteger(parsed) || parsed < 40) {
        throw new Error('--columns must be an integer >= 40')
      }
      columns = parsed
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    if (!isGalleryScreen(arg)) {
      throw new Error(`Unknown gallery screen: ${arg}`)
    }
    screen = arg
  }

  return { screen, columns, list }
}

try {
  const { screen, columns, list } = parseArgs(process.argv.slice(2))
  if (list) {
    printUsage()
    process.exit(0)
  }
  console.log(renderGalleryScreen(screen, { columns }))
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  console.error('')
  printUsage()
  process.exit(1)
}
