import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { buildSelectionItems } from '../../src/core/cli/onboarding-interactive'
import {
  OnboardingBusy,
  OnboardingCheckAllReport,
  OnboardingCheckReport,
  OnboardingAlreadyCompleteReport,
  OnboardingDecisionPrompt,
  OnboardingInstallReport,
  OnboardingIntro,
  OnboardingProgress,
  OnboardingRequiredReport,
  OnboardingSummary,
} from '../../src/core/cli/ui/onboarding'
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
    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboarding')
    expect(rendered).toContain('PREREQUISITES')
    expect(rendered).toContain('BLOCKED')
    expect(rendered).not.toContain('[BLOCKED')
    expect(rendered.replace(/\s+/g, '')).toContain('https://makinbakin.com/docs/start/first-time-setup/')
  })

  it('compacts home paths in the human onboarding summary', () => {
    const home = process.env.HOME
    if (!home) return

    const outcomes: ComponentOutcome[] = [
      {
        name: 'settings',
        finalStatus: 'ok',
        check: { name: 'settings', status: 'ok', message: 'settings ready' },
        message: `settings.json is present and parses at ${home}/.bakin/settings.json`,
        durationMs: 1,
      },
    ]

    const rendered = renderToString(<OnboardingSummary outcomes={outcomes} exitCode={0} />)
    expect(rendered).toContain('settings.json ready: ~/.bakin/settings.json')
    expect(rendered).not.toContain(`${home}/.bakin/settings.json`)
  })

  it('can render the onboarding summary as a continuation without the brand header', () => {
    const rendered = renderToString(
      <OnboardingSummary
        outcomes={[{
          name: 'settings',
          finalStatus: 'ok',
          check: { name: 'settings', status: 'ok', message: 'settings ready' },
          message: 'settings ready',
          durationMs: 1,
        }]}
        exitCode={0}
        showBrand={false}
      />,
    )

    expect(rendered).toContain('Onboarding')
    expect(rendered).not.toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
  })

  it('renders an async onboarding busy state', () => {
    const rendered = renderToString(<OnboardingBusy label="Running onboarding checks and installs" totalSteps={12} />)
    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('CURRENT ACTIVITY')
    expect(rendered).toContain('Running onboarding checks and installs')
    expect(rendered).toContain('Checking prerequisites and runtime access')
  })

  it('renders completed onboarding rows above the busy state', () => {
    const rendered = renderToString(
      <OnboardingBusy
        label="Running onboarding checks and installs"
        detail="Installing search"
        totalSteps={12}
        completed={[{ name: 'settings', status: 'complete', message: 'settings.json ready: ~/.bakin/settings.json' }]}
      />,
    )

    expect(rendered).toContain('OK')
    expect(rendered).not.toContain('[OK]')
    expect(rendered).toContain('settings.json ready: ~/.bakin/settings.json')
    expect(rendered).toContain('Installing search')
  })

  it('renders the onboarding intro with the shared compact header', () => {
    const rendered = renderToString(<OnboardingIntro />)
    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('Initial setup wizard')
    expect(rendered).not.toContain('oooooooooo')
    expect(rendered).not.toContain('Welcome to Bakin')
  })

  it('renders the start gate with shared onboarding UI', () => {
    const rendered = renderToString(<OnboardingRequiredReport />)
    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('Initial setup required')
    expect(rendered).toContain('REQUIRED SETUP')
    expect(rendered).toContain('Bakin has not been onboarded on this machine.')
    expect(rendered).toContain('Run `bakin onboard` to complete first-run setup.')
    expect(rendered).not.toContain('[OK]')
  })

  it('renders already-onboarded state with shared onboarding UI', () => {
    const rendered = renderToString(<OnboardingAlreadyCompleteReport state={{
      version: 3,
      completedAt: '2026-05-19T12:00:00.000Z',
      bakinVersion: '1.0.0',
      components: { mkdir: 'ok', settings: 'ok' },
    }} />)
    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboarding')
    expect(rendered).toContain('Machine setup already complete')
    expect(rendered).toContain('Already onboarded on 2026-05-19.')
    expect(rendered).toContain('Run `bakin onboard --force`')
    expect(rendered).not.toContain('[OK]')
  })

  it('renders confirmation prompts with shared sections instead of badges', () => {
    const rendered = renderToString(
      <OnboardingDecisionPrompt
        title="Search adapter"
        description="Antfly is not installed. Bakin will install Antfly via Homebrew if you continue."
        defaultChoice="confirm"
        onSubmit={() => {}}
      />,
    )
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('DECISION')
    expect(rendered).toContain('Search adapter')
    expect(rendered).toContain('Default: Yes')
    expect(rendered).not.toContain('[Search adapter]')
  })

  it('renders bounded onboarding progress with Ink UI', () => {
    const rendered = renderToString(<OnboardingProgress label="Installing official agents" value={50} />)
    expect(rendered).toContain('Installing official agents')
  })

  it('renders single component checks with shared TUI primitives', () => {
    const rendered = renderToString(
      <OnboardingCheckReport result={{
        name: 'runtime',
        status: 'warn',
        message: 'No runtime adapter is available.',
        remediation: 'Run `bakin onboard` to configure runtime access.',
      }} color={false} />,
    )

    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(rendered).toContain('Onboarding check')
    expect(rendered).toContain('RESULT')
    expect(rendered).toContain('No runtime adapter is available.')
    expect(rendered).not.toContain('[WARN]')
  })

  it('renders all component checks with shared TUI primitives', () => {
    const rendered = renderToString(
      <OnboardingCheckAllReport results={[
        { name: 'runtime', status: 'ok', message: 'Runtime ready.' },
        { name: 'llm', status: 'warn', message: 'No LLM provider configured.', remediation: 'Configure at least one provider.' },
      ]} color={false} />,
    )

    expect(rendered).toContain('Onboarding checks')
    expect(rendered).toContain('CHECKS')
    expect(rendered).toContain('runtime')
    expect(rendered).toContain('No LLM provider configured.')
    expect(rendered).not.toContain('[OK]')
  })

  it('renders component install results with shared TUI primitives', () => {
    const rendered = renderToString(
      <OnboardingInstallReport result={{
        name: 'plugin-assets',
        status: 'installed',
        message: 'Installed plugin assets.',
        durationMs: 12,
      }} color={false} />,
    )

    expect(rendered).toContain('Onboarding install')
    expect(rendered).toContain('RESULT')
    expect(rendered).toContain('Installed plugin assets.')
    expect(rendered).toContain('12ms')
    expect(rendered).not.toContain('[INSTALLED]')
  })
})
