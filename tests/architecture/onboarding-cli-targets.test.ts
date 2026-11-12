/**
 * `bakin check <x>` accepts every onboarding component and `bakin install
 * <x>` every installable one (onboarding hardening, spec §8). Both lists,
 * their unknown-subcommand hints and the help text come from ONE list of
 * names; a second list kept by hand is how `bakin install capabilities`
 * once worked while its own hint said it did not exist.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8')

/** Code only: a component name in a comment is prose, not a list. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Component names that only ever appear in a list of component names. */
const TELLTALE = ['search-models', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents', 'openclaw-integration']

describe('onboarding CLI targets derive from the component list', () => {
  it('the command module names no component by hand', () => {
    const text = code(read('src/cli/commands/onboarding.ts'))
    const hits = TELLTALE.filter((name) => text.includes(`'${name}'`) || text.includes(`"${name}"`))
    expect(hits).toEqual([])
  })

  it('the command module takes its targets from the name lists', () => {
    const text = read('src/cli/commands/onboarding.ts')
    expect(text).toContain('isComponentName(sub)')
    expect(text).toContain('isInstallableComponentName(sub)')
    expect(text).toContain("exitUnknownSubcommand('check', sub, [...COMPONENT_NAMES, 'all'])")
    expect(text).toContain("exitUnknownSubcommand('install', sub, [...INSTALLABLE_COMPONENT_NAMES])")
  })

  it('the help text for check and install is built from the same lists', () => {
    const text = read('src/core/cli/registry.ts')
    expect(text).toContain("usage: `bakin check <${COMPONENT_NAMES.join('|')}|all> [--json]`")
    expect(text).toContain("usage: `bakin install <${INSTALLABLE_COMPONENT_NAMES.join('|')}> [--yes] [--json]`")
    // No hand-written alternation of component names anywhere in the registry.
    expect(code(text)).not.toMatch(/search-models\|/)
  })

  it('the install request schema uses the same installable list', () => {
    expect(read('src/core/onboarding/install-request.ts')).toContain('INSTALLABLE_COMPONENT_NAMES')
  })
})
