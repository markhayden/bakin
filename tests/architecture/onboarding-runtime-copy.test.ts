/**
 * Onboarding speaks about the ACTIVE runtime (onboarding hardening, spec
 * §3). There is no "default runtime" whose setup guide, docs or login steps
 * may be shown to someone on another runtime: a home on Pi was once told
 * to go and install OpenClaw.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
/** Everything that can put onboarding words in front of an operator. */
const SCAN_ROOTS = ['src/core/onboarding', 'src/core/cli', 'src/cli']
const FACTORY = 'src/core/runtime-adapter-factory.ts'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('onboarding copy comes from the active runtime', () => {
  it('nothing reaches for a default runtime\'s copy', () => {
    const hits: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        if (/DEFAULT_RUNTIME_ADAPTER_SUPPORT/.test(readFileSync(file, 'utf-8'))) hits.push(relative(ROOT, file))
      }
    }
    expect(hits).toEqual([])
  })

  it('the factory offers no default-runtime copy to reach for', () => {
    expect(readFileSync(join(ROOT, FACTORY), 'utf-8')).not.toMatch(/DEFAULT_RUNTIME_ADAPTER_SUPPORT/)
  })

  it('onboarding component copy names no runtime in a string: the runtime\'s own entry does', () => {
    // A provider name inside a message or remediation literal is a message
    // that is wrong on the other runtime. Identifiers (the
    // `openclaw-integration` component, adapter ids in code) are not copy.
    const hits: string[] = []
    for (const file of [join(ROOT, 'src/core/onboarding/runtime.ts'), join(ROOT, 'src/core/onboarding/credentials.ts')]) {
      const text = readFileSync(file, 'utf-8')
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        if (/\b(OpenClaw|Pi)\b/.test(match[2]!)) hits.push(`${relative(ROOT, file)}: ${match[2]!.slice(0, 80)}`)
      }
    }
    expect(hits).toEqual([])
  })
})
