import { describe, expect, it } from 'bun:test'

import { GALLERY_SCREENS, isGalleryScreen, renderGalleryScreen } from '../../src/core/cli/ui/tui-gallery'

function visibleLineLengths(output: string): number[] {
  return output
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => line.length)
}

describe('CLI TUI style gallery', () => {
  it('lists every prototype screen as a valid gallery target', () => {
    expect(isGalleryScreen('all')).toBe(true)
    for (const screen of GALLERY_SCREENS) {
      expect(isGalleryScreen(screen)).toBe(true)
    }
    expect(isGalleryScreen('real-command')).toBe(false)
  })

  it('renders all prototype screens from fixture data', () => {
    const output = renderGalleryScreen('all', { columns: 120 })

    expect(output).toContain('--- doctor ---')
    expect(output).toContain('--- doctor-fix ---')
    expect(output).toContain('--- plugins ---')
    expect(output).toContain('--- onboard ---')
    expect(output).toContain('--- onboard-antfly-confirm ---')
    expect(output).toContain('--- onboard-plugin-selection ---')
    expect(output).toContain('--- onboard-agent-selection ---')
    expect(output).toContain('LOCAL CHECKS\n------------')
    expect(output).toContain('Onboarding')
    expect(output).toContain('Command failed')
  })

  it('renders the Bakin brand header on every prototype screen', () => {
    for (const screen of GALLERY_SCREENS) {
      const output = renderGalleryScreen(screen, { columns: 100 })
      const lines = output.split('\n')
      expect(lines[0]).toBe('')
      // The box widens past its 38-char minimum when APP_VERSION is long
      // (describe-stamped self-builds) — assert shape, not a fixed width.
      expect(lines[1]).toMatch(/^┏━{38,}┓$/)
      expect(lines[2]).toContain("┃ 🐷 Bakin'")
      expect(lines[2]).toContain('(v')
      expect(lines[3]).toMatch(/^┗━{38,}┛$/)
      expect(lines[2].length).toBe(lines[1].length)
      expect(lines[3].length).toBe(lines[1].length)
      expect(lines[4]).toBe('')
    }
  })

  it('keeps status tokens intact in wide doctor output', () => {
    const output = renderGalleryScreen('doctor', { columns: 132 })

    expect(output).toContain(' WARN      agent-sync')
    expect(output).toContain(' SKIP      runtime')
    expect(output).not.toContain('[WARN]')
    expect(output).not.toContain('[SKIP]')
  })

  it('wraps narrow doctor output within the requested terminal width', () => {
    const output = renderGalleryScreen('doctor', { columns: 72 })
    const maxLineLength = Math.max(...visibleLineLengths(output))

    expect(maxLineLength).toBeLessThanOrEqual(72)
    expect(output).toContain('1 agent-package projection needs')
    expect(output).toContain('repair; patch is missing from the')
    expect(output).toContain('runtime workspace.')
  })

  it('shows realistic repair and delegated follow-up actions', () => {
    const repair = renderGalleryScreen('doctor-fix', { columns: 110 })
    const delegated = renderGalleryScreen('doctor-delegate', { columns: 110 })

    expect(repair).toContain('Run `bakin doctor --fix --yes`')
    expect(repair).toContain('SAFE DETERMINISTIC REPAIRS')
    expect(delegated).toContain('task-184')
    expect(delegated).toContain('bakin doctor repair verify')
  })

  it('renders an onboard mock with async setup feedback', () => {
    const output = renderGalleryScreen('onboard', { columns: 100 })
    const maxLineLength = Math.max(...visibleLineLengths(output))

    expect(maxLineLength).toBeLessThanOrEqual(100)
    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Onboard  step 7 of 11')
    expect(output).toContain('Setting up this machine')
    expect(output).toContain('CURRENT ACTIVITY')
    expect(output).toContain('Async job 2 of 4')
    expect(output).toContain('RECENT FEEDBACK')
    expect(output).toContain('Recommended agent package selection will be confirmed next.')
  })

  it('renders onboarding confirmation and selection mocks', () => {
    const antfly = renderGalleryScreen('onboard-antfly-confirm', { columns: 100 })
    const plugins = renderGalleryScreen('onboard-plugin-selection', { columns: 100 })
    const agents = renderGalleryScreen('onboard-agent-selection', { columns: 100 })

    expect(antfly).toContain('Install Antfly search adapter? y/N')
    expect(antfly).toContain('Default: No')
    expect(plugins).toContain('Use up/down to move, space to select, enter to continue.')
    expect(plugins).not.toContain('INSTALL OFFICIAL PLUGINS')
    expect(plugins).toContain('\u276f [Messaging]')
    expect(plugins).toContain('\u2714')
    expect(plugins).toContain('Messaging and Projects will be installed from the official')
    expect(plugins).toContain('catalog.')
    expect(agents).not.toContain('INSTALL OFFICIAL AGENTS')
    expect(agents).toContain('\u276f [Patch]')
    expect(agents).toContain('\u2714')
    expect(agents).toContain('runtime main agent is already installed')
  })
})
