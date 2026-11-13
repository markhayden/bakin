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

describe('Pi login steps state the Pi command line tool\'s own requirements', () => {
  it('the Node floor in the install step is the one the pinned Pi package declares', () => {
    // The step tells a new user what Node they need to install `pi`. That
    // number belongs to the Pi package, so a Pi bump that raises it must
    // change the step with it.
    const entry = Bun.resolveSync('@earendil-works/pi-coding-agent', join(ROOT, 'packages', 'adapter-pi'))
    const packageRoot = entry.slice(0, entry.lastIndexOf('pi-coding-agent') + 'pi-coding-agent'.length)
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as { name: string; bin?: Record<string, string>; engines?: { node?: string } }
    const floor = /^>=(\d+\.\d+)\.0$/.exec(manifest.engines?.node ?? '')?.[1]
    expect(floor).toBeDefined()
    expect(manifest.bin).toHaveProperty('pi')

    const factory = readFileSync(join(ROOT, FACTORY), 'utf-8')
    expect(factory).toContain(`npm install -g ${manifest.name}`)
    expect(factory).toContain(`needs Node ${floor} or newer`)
  })
})
