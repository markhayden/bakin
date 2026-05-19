import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { DoctorReport } from '../../src/core/cli/ui/doctor'

describe('doctor CLI UI', () => {
  it('renders health check rows with shared TUI primitives', () => {
    const rendered = renderToString(
      <DoctorReport
        results={[
          { check: 'plugins.assets', status: 'ok', message: 'Assets healthy' },
          { check: 'runtime', status: 'warn', message: 'Runtime slow' },
          { check: 'server-backed-checks', status: 'warn', message: 'Skipped checks that require the Bakin server.' },
        ]}
        summary={{ total: 3, errors: 0, warnings: 2 }}
        mode="offline"
        color={false}
      />,
    )

    expect(rendered).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(rendered).toContain('Doctor  mode: offline')
    expect(rendered).toContain(' OK       0 errors')
    expect(rendered).toContain(' WARN     1 warning')
    expect(rendered).toContain(' SKIP     1 skipped')
    expect(rendered).toContain('3 checks')
    expect(rendered).toContain('HEALTH CHECKS\n-----------------')
    expect(rendered).toContain('plugins.assets')
    expect(rendered).toContain('Runtime slow')
    expect(rendered).toContain('Skipped checks that require the Bakin server.')
    expect(rendered).toContain('NEXT\n------------')
    expect(rendered).toContain('Run `bakin start`, then `bakin doctor --full`')
    expect(rendered).toContain('Run `bakin doctor --delegate`')
    expect(rendered).not.toContain('[WARN]')
  })

  it('does not treat skipped server checks as delegated repair warnings', () => {
    const rendered = renderToString(
      <DoctorReport
        results={[
          { check: 'home', status: 'ok', message: 'Bakin home directory is initialized.' },
          { check: 'runtime', status: 'warn', message: 'Skipped live runtime checks in offline mode.' },
        ]}
        summary={{ total: 2, errors: 0, warnings: 1 }}
        mode="offline"
        color={false}
      />,
    )

    expect(rendered).toContain(' OK       0 warnings')
    expect(rendered).toContain(' SKIP     1 skipped')
    expect(rendered).toContain('Run `bakin start`, then `bakin doctor --full`')
    expect(rendered).not.toContain('Run `bakin doctor --delegate`')
  })
})
