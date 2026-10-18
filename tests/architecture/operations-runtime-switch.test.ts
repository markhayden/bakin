/**
 * PR6 (#895, PLAN § 6.3): the runtime switch is an operation.
 *
 * - No `runtime:switch` events: progress is the operation's stages.
 * - The switch's private progress stream, its step reducer and its
 *   single-flight flag are gone (install-state serializes switches).
 * - `new EventSource` appears only in the shell's one connection
 *   (`use-sse.ts`) and the dev-loop client — every surface subscribes
 *   through `usePluginEvent` (the schedule hooks moved over in #990).
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'cli', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor', 'public'])

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

/** Code only — comment lines dropped. */
const code = (text: string): string => text.split('\n').filter((line) => {
  const t = line.trim()
  return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
}).join('\n')

const EVENT_SOURCE_ALLOWED = new Set([
  'src/hooks/use-sse.ts',
  'packages/host/src/dev-client/client.ts',
])

const DELETED = [/runtime:switch/, /\breduceSwitchProgress\b/, /\bSWITCH_PHASE_LABELS\b/, /\bSwitchStepRow\b/, /\bswitchInFlight\b/]

export function eventSourceHits(file: string, text: string): string[] {
  return /new\s+EventSource\s*\(/.test(code(text)) && !EVENT_SOURCE_ALLOWED.has(file) ? [file] : []
}

function scan(check: (file: string, text: string) => string[]): string[] {
  const hits: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(ROOT, root))) hits.push(...check(relative(ROOT, file), readFileSync(file, 'utf-8')))
  }
  return hits
}

describe('the runtime switch is an operation (#895 PR6)', () => {
  it('no runtime:switch events, step reducer or single-flight flag', () => {
    expect(scan((file, text) => DELETED.filter((re) => re.test(code(text))).map((re) => `${file}: ${re.source}`))).toEqual([])
  })

  it('switchRuntime takes an operation, not a progress callback', () => {
    expect(code(readFileSync(join(ROOT, 'src/core/runtime-switch.ts'), 'utf-8'))).not.toMatch(/\bonProgress\b/)
  })

  it('new EventSource only in the allowed connections', () => {
    expect(scan(eventSourceHits)).toEqual([])
  })

  it('TEETH: the EventSource scanner flags a private stream and ignores a comment about one', () => {
    expect(eventSourceHits('plugins/x/hook.ts', "const es = new EventSource('/api/events')")).toEqual(['plugins/x/hook.ts'])
    expect(eventSourceHits('plugins/x/hook.ts', "// no new EventSource('/api/events') here")).toEqual([])
    expect(eventSourceHits('src/hooks/use-sse.ts', "const es = new EventSource('/api/events')")).toEqual([])
  })
})
