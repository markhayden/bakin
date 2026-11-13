/**
 * Runtime presence probes (onboarding hardening, spec §2): each adapter
 * answers "am I set up on this machine" with one stat inside its own home;
 * the factory composes them in a fixed order. Nothing is written.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(tmpdir(), `bakin-test-runtime-presence-${Date.now()}-${randomUUID()}`)
// The adapters read these when first asked; set them before any import.
process.env.BAKIN_HOME = join(root, 'bakin')
process.env.PI_HOME = join(root, 'pi')
process.env.OPENCLAW_HOME = join(root, 'openclaw')

import { isOpenClawPresent } from '../../packages/adapter-openclaw/src/presence'
import { isPiPresent } from '../../packages/adapter-pi/src/presence'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { detectRuntimes, getRuntimeAdapterSupport } from '../../src/core/runtime-adapter-factory'

const piAgentDir = join(root, 'pi', 'agent')
const openClawConfig = join(root, 'openclaw', 'openclaw.json')

/** Every path under the root with its type and content hash. */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      if (statSync(full).isDirectory()) {
        out[`${full}/`] = 'dir'
        walk(full)
      } else {
        out[full] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk(dir)
  return out
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  resetPiHome()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('presence probes', () => {
  test('nothing set up: neither runtime is present and nothing is created', () => {
    expect(isPiPresent()).toBe(false)
    expect(isOpenClawPresent()).toBe(false)
    expect(detectRuntimes()).toEqual([])
    expect(readdirSync(root)).toEqual([])
  })

  test('Pi is present when its agent directory exists, logged in or not', () => {
    mkdirSync(piAgentDir, { recursive: true })
    expect(isPiPresent()).toBe(true)
    expect(detectRuntimes()).toEqual(['pi'])
  })

  test('a bare Pi home without an agent directory is not a Pi install', () => {
    mkdirSync(join(root, 'pi'), { recursive: true })
    expect(isPiPresent()).toBe(false)
  })

  test('a FILE where the agent directory should be is not a Pi install', () => {
    mkdirSync(join(root, 'pi'), { recursive: true })
    writeFileSync(piAgentDir, 'not a directory')
    expect(isPiPresent()).toBe(false)
  })

  test('OpenClaw is present when its home holds a config file, even one Bakin could not parse', () => {
    mkdirSync(join(root, 'openclaw'), { recursive: true })
    writeFileSync(openClawConfig, '{ this is not json')
    expect(isOpenClawPresent()).toBe(true)
    expect(detectRuntimes()).toEqual(['openclaw'])
  })

  test('an OpenClaw home without a config file is not an OpenClaw install', () => {
    mkdirSync(join(root, 'openclaw', 'workspace'), { recursive: true })
    expect(isOpenClawPresent()).toBe(false)
  })

  test('both present: the order is fixed, openclaw then pi', () => {
    mkdirSync(piAgentDir, { recursive: true })
    mkdirSync(join(root, 'openclaw'), { recursive: true })
    writeFileSync(openClawConfig, '{}')
    expect(detectRuntimes()).toEqual(['openclaw', 'pi'])
  })

  test('probing changes nothing on disk', () => {
    mkdirSync(piAgentDir, { recursive: true })
    writeFileSync(join(piAgentDir, 'auth.json'), '{}')
    mkdirSync(join(root, 'openclaw'), { recursive: true })
    writeFileSync(openClawConfig, '{}')
    const before = fingerprint(root)
    detectRuntimes()
    detectRuntimes()
    expect(fingerprint(root)).toEqual(before)
  })
})

describe('how a provider is logged in, per runtime', () => {
  test('Pi names the command that starts its sign-in; it is the one its own steps say to run', () => {
    const pi = getRuntimeAdapterSupport('pi')
    expect(pi.loginCommand).toBe('pi')
    expect(pi.loginSteps[0]).toContain(`\`${pi.loginCommand}\``)
  })

  test('OpenClaw has steps but no single command to hand over', () => {
    const openclaw = getRuntimeAdapterSupport('openclaw')
    expect(openclaw.loginSteps.length).toBeGreaterThan(0)
    expect(openclaw.loginCommand).toBeUndefined()
  })
})
