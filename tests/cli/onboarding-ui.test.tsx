import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { buildSelectionItems } from '../../src/core/cli/onboarding-interactive'
import {
  checklistLines,
  OnboardingBusy,
  OnboardingChecklist,
  OnboardingCheckAllReport,
  OnboardingCheckReport,
  OnboardingAlreadyCompleteReport,
  OnboardingCredentialsPrompt,
  OnboardingDecisionPrompt,
  OnboardingInstallReport,
  OnboardingIntro,
  OnboardingProgress,
  OnboardingRequiredReport,
  OnboardingRuntimePrompt,
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
    expect(rendered).toContain("┃ 🐷 Bakin'")
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
    expect(rendered).not.toContain("┃ 🐷 Bakin'")
  })

  it('renders an async onboarding busy state', () => {
    const rendered = renderToString(<OnboardingBusy label="Running onboarding checks and installs" totalSteps={12} />)
    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('CURRENT ACTIVITY')
    expect(rendered).toContain('Running onboarding checks and installs')
    expect(rendered).toContain('Checking prerequisites and runtime access')
  })

  it('can render the async onboarding busy state as a continuation without the brand', () => {
    const rendered = renderToString(
      <OnboardingBusy
        label="Running onboarding checks and installs"
        totalSteps={12}
        showBrand={false}
      />,
    )
    expect(rendered).toContain('Onboard')
    expect(rendered).not.toContain("┃ 🐷 Bakin'")
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
    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Onboard')
    expect(rendered).toContain('Initial setup wizard')
    expect(rendered).not.toContain('oooooooooo')
    expect(rendered).not.toContain('Welcome to Bakin')
  })

  it('renders the start gate with shared onboarding UI', () => {
    const rendered = renderToString(<OnboardingRequiredReport />)
    expect(rendered).toContain("┃ 🐷 Bakin'")
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
    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Onboarding')
    expect(rendered).toContain('Machine setup already complete')
    expect(rendered).toContain('Already onboarded on 2026-05-19.')
    expect(rendered).toContain('Run `bakin onboard --force`')
    expect(rendered).not.toContain('[OK]')
  })

  describe('setup checklist', () => {
    const checklist = {
      items: [
        { id: 'login', title: 'Log in to Pi', state: 'todo' as const, detail: 'Run `pi`. Type `/login`.' },
        { id: 'search', title: 'Search', state: 'done' as const, detail: 'Search engine is installed.' },
        { id: 'channels', title: 'Channels', state: 'todo' as const, detail: 'Discord delivery is off.', href: '/settings?tab=channels' },
        { id: 'capability-key:web-search', title: 'Web search key', state: 'unknown' as const, detail: 'Could not tell: lockfile unreadable' },
        { id: 'model-plan', title: 'Model plan', state: 'todo' as const, detail: 'No model plan chosen yet.', command: 'bakin models plan --apply' },
      ],
      notes: [
        { id: 'start', title: 'Start Bakin', detail: 'Launch the server and open the dashboard.', command: 'bakin start' },
        { id: 'explore', title: 'Browse Explore', detail: 'Add agents, plugins and capabilities whenever you want them.', href: '/explore' },
      ],
    }
    const text = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/\s+/g, ' ')

    it('lists what is left before what is done, with how to do each', () => {
      const rendered = text(<OnboardingChecklist checklist={checklist} />)
      expect(rendered).toContain('SETUP CHECKLIST')
      expect(rendered).toContain('TODO')
      expect(rendered).toContain('DONE')
      // To do and could-not-tell come before done.
      expect(rendered.indexOf('Log in to Pi')).toBeLessThan(rendered.indexOf('Search engine is installed.'))
      expect(rendered.indexOf('Model plan')).toBeLessThan(rendered.indexOf('Search engine is installed.'))
      expect(rendered).toContain('Run `bakin models plan --apply`.')
      expect(rendered).toContain('In the browser: /settings?tab=channels')
      expect(rendered).toContain('Could not tell: lockfile unreadable')
      expect(rendered).toContain('Start Bakin: Launch the server and open the dashboard. Run `bakin start`.')
      expect(rendered).toContain('Browse Explore')
    })

    it('says so when nothing is left', () => {
      const rendered = text(<OnboardingChecklist checklist={{ items: [], notes: checklist.notes }} />)
      expect(rendered).toContain('Nothing else to set up.')
    })

    it('the finish screen shows the checklist in place of the generic next step', () => {
      const outcome = { name: 'mkdir', finalStatus: 'ok' as const, check: { name: 'mkdir', status: 'ok' as const, message: 'ok' }, message: 'Home ready', durationMs: 1 }
      const withChecklist = text(<OnboardingSummary outcomes={[outcome]} exitCode={2} checklist={checklist} />)
      expect(withChecklist).toContain('SETUP CHECKLIST')
      expect(withChecklist).not.toContain('then `bakin doctor` for details')
      const without = text(<OnboardingSummary outcomes={[outcome]} exitCode={2} />)
      expect(without).not.toContain('SETUP CHECKLIST')
      expect(without).toContain('bakin start')
    })

    it('a blocked run shows its blocker, never a checklist', () => {
      const blocked = { name: 'runtime', finalStatus: 'error' as const, check: { name: 'runtime', status: 'error' as const, message: 'unreachable' }, message: 'unreachable', remediation: 'Start the gateway.', durationMs: 1 }
      const rendered = text(<OnboardingSummary outcomes={[blocked]} exitCode={1} checklist={checklist} />)
      expect(rendered).not.toContain('SETUP CHECKLIST')
      expect(rendered).toContain('Rerun `bakin onboard` after the blocker is resolved.')
    })

    it('plain lines carry the same items for output that is not a terminal', () => {
      expect(checklistLines(checklist)).toEqual([
        'Setup checklist:',
        '  [ ] Log in to Pi — Run `pi`. Type `/login`.',
        '  [x] Search — Search engine is installed.',
        '  [ ] Channels — Discord delivery is off.',
        '        In the browser: /settings?tab=channels',
        '  [?] Web search key — Could not tell: lockfile unreadable',
        '  [ ] Model plan — No model plan chosen yet.',
        '        Run `bakin models plan --apply`.',
        'Next:',
        '  - Start Bakin: Launch the server and open the dashboard. Run `bakin start`.',
        '  - Browse Explore: Add agents, plugins and capabilities whenever you want them. In the browser: /explore',
      ])
    })
  })

  describe('credentials screen', () => {
    const props = {
      runtimeLabel: 'Pi',
      steps: ['Open another terminal and run `pi`.', 'Type `/login` and pick a provider (there is no `pi login` command).', 'Finish the sign-in, then quit pi.'],
      docsUrl: 'https://pi.dev/docs/latest',
      onSubmit: () => {},
    }
    /** The screen wraps long lines to the terminal width; compare the words, not the line breaks. */
    const text = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/\s+/g, ' ')

    it('says the runtime works, how to log in in its own words, and what each key does', () => {
      const rendered = text(<OnboardingCredentialsPrompt {...props} />)
      expect(rendered).toContain('Log in to Pi')
      expect(rendered).toContain('Pi is running, but no provider is logged in yet')
      expect(rendered).toContain('1. Open another terminal and run `pi`.')
      expect(rendered).toContain('2. Type `/login`')
      expect(rendered).toContain('3. Finish the sign-in')
      expect(rendered).toContain('https://pi.dev/docs/latest')
      expect(rendered).toContain('Press Enter when you are logged in')
      expect(rendered).toContain('to finish setup without a login')
      // The promise the step rests on.
      expect(rendered).toContain('Bakin never sees your credentials')
    })

    it('after a recheck that found nothing it says so instead of repeating the first message', () => {
      const once = text(<OnboardingCredentialsPrompt {...props} attempts={1} />)
      expect(once).toContain('Still no provider logged in to Pi')
      expect(once).not.toContain('is running, but no provider is logged in yet')
      const thrice = text(<OnboardingCredentialsPrompt {...props} attempts={3} />)
      expect(thrice).toContain('checked 3 times')
    })

    it('carries no wording of another runtime: every word comes from the props', () => {
      const rendered = text(<OnboardingCredentialsPrompt {...props} runtimeLabel="OpenClaw" steps={['Add a provider login in OpenClaw.']} docsUrl="https://openclaw.ai/docs/" />)
      expect(rendered).toContain('Log in to OpenClaw')
      expect(rendered).not.toMatch(/\bPi\b|\/login/)
    })
  })

  describe('runtime selection screen', () => {
    const options = [
      { adapter: 'openclaw', label: 'OpenClaw', summary: 'A separate gateway you install and run alongside Bakin.', found: false },
      { adapter: 'pi', label: 'Pi', summary: 'Runs inside Bakin; nothing else to install.', found: true },
    ]

    it('offers every supported runtime and marks the ones found on this machine', () => {
      const rendered = renderToString(<OnboardingRuntimePrompt options={options} preselected="pi" onSubmit={() => {}} />)
      expect(rendered).toContain('Choose the agent runtime')
      expect(rendered).toContain('Which runtime should this home use?')
      expect(rendered).toContain('OpenClaw')
      expect(rendered).toContain('Pi (found)')
      expect(rendered).toContain('Not found on this machine.')
      expect(rendered).toContain('Found on this machine.')
      // How to change it later is said where the choice is made.
      expect(rendered).toContain('bakin runtime use')
    })

    it('counts what was found', () => {
      const both = options.map((option) => ({ ...option, found: true }))
      const rendered = renderToString(<OnboardingRuntimePrompt options={both} preselected="openclaw" onSubmit={() => {}} />)
      expect(rendered).toContain('OpenClaw (found)')
      expect(rendered).toContain('Pi (found)')
      expect(rendered).not.toContain('Not found on this machine.')
    })

    it('puts the pointer on the preselected runtime: what Enter picks', () => {
      const lineWithPointer = (preselected: string) => renderToString(<OnboardingRuntimePrompt options={options} preselected={preselected} onSubmit={() => {}} />)
        .split('\n').find((line) => line.includes('❯')) ?? ''
      expect(lineWithPointer('pi')).toContain('Pi (found)')
      expect(lineWithPointer('openclaw')).toContain('OpenClaw')
    })
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

  it('can render confirmation prompts as onboarding continuations without repeating the brand', () => {
    const rendered = renderToString(
      <OnboardingDecisionPrompt
        title="Search adapter"
        description="Antfly is not installed."
        defaultChoice="confirm"
        showBrand={false}
        onSubmit={() => {}}
      />,
    )

    expect(rendered).toContain('Onboard')
    expect(rendered).not.toContain("┃ 🐷 Bakin'")
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

    expect(rendered).toContain("┃ 🐷 Bakin'")
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
