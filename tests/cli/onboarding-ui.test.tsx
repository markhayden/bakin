import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { buildSelectionItems } from '../../src/core/cli/onboarding-interactive'
import { OnboardingBusy, OnboardingSummary } from '../../src/core/cli/ui/onboarding'
import type { ComponentOutcome } from '../../src/core/onboarding'

describe('onboarding CLI UI', () => {
  it('builds disabled installed rows and selected missing defaults', () => {
    const items = buildSelectionItems({
      name: 'recommended-plugins',
      status: 'missing',
      message: 'missing',
      details: {
        missing: ['projects'],
        available: [
          { id: 'messaging', name: 'Messaging', description: 'Installed already', defaultSelected: true },
          { id: 'projects', name: 'Projects', description: 'Project tools', defaultSelected: true },
        ],
      },
    })

    expect(items).toEqual([
      {
        id: 'messaging',
        label: 'Messaging',
        description: 'Installed already',
        selected: false,
        disabled: true,
        note: 'installed',
      },
      {
        id: 'projects',
        label: 'Projects',
        description: 'Project tools',
        selected: true,
        disabled: false,
        note: undefined,
      },
    ])
  })

  it('renders a runtime blocker with remediation', () => {
    const outcomes: ComponentOutcome[] = [
      {
        name: 'mkdir',
        finalStatus: 'ok',
        check: { name: 'mkdir', status: 'ok', message: 'home ready' },
        message: 'home ready',
        durationMs: 1,
      },
      {
        name: 'runtime',
        finalStatus: 'error',
        check: { name: 'runtime', status: 'missing', message: 'runtime missing' },
        message: 'Bakin requires an active agent runtime such as OpenClaw.',
        remediation: 'Read https://makinbakin.com/docs/start/first-time-setup/',
        durationMs: 1,
      },
    ]

    const rendered = renderToString(<OnboardingSummary outcomes={outcomes} exitCode={1} />)
    expect(rendered).toContain('Bakin onboarding')
    expect(rendered).toContain('[BLOCKED')
    expect(rendered).toContain('https://makinbakin.com/docs/start/first-time-setup/')
  })

  it('renders an async onboarding busy state', () => {
    const rendered = renderToString(<OnboardingBusy label="Running onboarding checks and installs" />)
    expect(rendered).toContain('Running onboarding checks and installs')
  })
})
