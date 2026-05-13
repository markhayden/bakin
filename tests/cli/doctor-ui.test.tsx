import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { DoctorReport } from '../../src/core/cli/ui/doctor'

describe('doctor CLI UI', () => {
  it('renders health check rows and summary', () => {
    const rendered = renderToString(
      <DoctorReport
        results={[
          { check: 'plugins.assets', status: 'ok', message: 'Assets healthy' },
          { check: 'runtime', status: 'warn', message: 'Runtime slow' },
        ]}
        summary={{ total: 2, errors: 0, warnings: 1 }}
      />,
    )

    expect(rendered).toContain('Bakin doctor')
    expect(rendered).toContain('plugins.assets')
    expect(rendered).toContain('[WARN]')
    expect(rendered).toContain('1 warnings out of 2 checks')
  })
})
