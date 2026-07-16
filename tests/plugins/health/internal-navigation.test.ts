import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const COMPONENTS_DIR = join(import.meta.dir, '../../../plugins/health/components')

describe('Health internal navigation', () => {
  it('uses the client router for every link that leaves the current document section', () => {
    const rawNavigationAnchors: string[] = []

    for (const file of readdirSync(COMPONENTS_DIR).filter((name) => name.endsWith('.tsx'))) {
      const source = readFileSync(join(COMPONENTS_DIR, file), 'utf-8')
      const anchors = source.match(/<a\b[\s\S]*?>/g) ?? []

      for (const anchor of anchors) {
        // The Activity pulse owns this same-document anchor so it can smooth
        // scroll and move focus after the target disclosure mounts.
        if (/href=["']#/.test(anchor)) continue
        rawNavigationAnchors.push(`${file}: ${anchor.replace(/\s+/g, ' ')}`)
      }
    }

    expect(rawNavigationAnchors).toEqual([])
  })
})
