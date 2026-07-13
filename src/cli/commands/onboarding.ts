/**
 * `bakin paths` / `bakin mkdir` / `bakin check` / `bakin install` /
 * `bakin onboard` / `bakin settings init` — onboarding component checks,
 * installs, and the interactive onboarding flow. Relocated verbatim from
 * cli/bakin.ts (B5.3 command-module split).
 *
 * cmdOnboardingSettingsInit is exported: the settings command module routes
 * `bakin settings init` here.
 */
import { apiGet } from '../http'
import { print, statusIcon } from '../output'
import { exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { CheckResult, InstallResult } from '../../core/onboarding/types'

async function printPathsTui(paths: Record<string, unknown>, isBakinHome: unknown): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PathsReport, { paths, isBakinHome })
}

async function printOnboardingCheckTui(result: CheckResult): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/onboarding'), (m) => m.OnboardingCheckReport, { result })
}

async function printOnboardingCheckAllTui(results: CheckResult[]): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/onboarding'), (m) => m.OnboardingCheckAllReport, { results })
}

async function printOnboardingInstallTui(result: InstallResult): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/onboarding'), (m) => m.OnboardingInstallReport, { result })
}

async function cmdPaths(key?: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet(`/api/paths${key ? `?key=${encodeURIComponent(key)}` : ''}`) as Record<string, unknown>

  if (opts.json) {
    print(result)
    return
  }

  if (key) {
    if (process.stdout.isTTY) {
      await printPathsTui({ [key]: result.path }, result.isBakinHome)
      return
    }
    // Single path in non-TTY mode prints just the value for scripting.
    console.log(result.path)
  } else {
    const paths = result.paths as Record<string, unknown>
    if (process.stdout.isTTY) {
      await printPathsTui(paths, result.isBakinHome)
      return
    }
    const isHome = result.isBakinHome ? '~/.bakin' : './content (not migrated)'
    console.log(`Content dir: ${isHome}`)
    console.log('')
    for (const [k, v] of Object.entries(paths)) {
      console.log(`  ${k.padEnd(12)} ${v}`)
    }
  }
}

async function withTtyRuntimeLogsSilenced<T>(
  options: { isTTY: boolean; verbose?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  const shouldSilenceRuntimeLogs = options.isTTY && options.verbose !== true && previousConsoleFormat === undefined
  try {
    if (shouldSilenceRuntimeLogs) process.env.BAKIN_CONSOLE_FORMAT = 'silent'
    return await run()
  } finally {
    if (shouldSilenceRuntimeLogs) delete process.env.BAKIN_CONSOLE_FORMAT
  }
}

async function cmdOnboardingMkdir(options: { json?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const json = options.json === true
  const opts = {
    interactive: isTTY && !json,
    autoApprove: true,
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY }, async () => {
    const { mkdirComponent } = await import('../../core/onboarding/mkdir')
    return await mkdirComponent.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

export async function cmdOnboardingSettingsInit(options: { json?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const json = options.json === true
  const opts = {
    interactive: isTTY && !json,
    autoApprove: true,
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY }, async () => {
    const { settingsComponent } = await import('../../core/onboarding/settings')
    return await settingsComponent.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingCheckSingle(
  target: 'runtime' | 'search' | 'search-models' | 'llm' | 'channels' | 'plugin-assets' | 'agent-sync' | 'recommended-plugins' | 'recommended-agents' | 'capabilities',
  options: { verbose?: boolean } = {},
): Promise<void> {
  const componentMap: Record<string, () => Promise<{ check(): Promise<import('../../core/onboarding/types').CheckResult> }>> = {
    runtime: async () => (await import('../../core/onboarding/runtime')).runtimeComponent,
    search: async () => (await import('../../core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../../core/onboarding/search-models')).searchModelsComponent,
    llm: async () => (await import('../../core/onboarding/credentials')).llmComponent,
    channels: async () => (await import('../../core/onboarding/credentials')).channelsComponent,
    'plugin-assets': async () => (await import('../../core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-sync': async () => (await import('../../core/onboarding/agent-sync')).agentSyncComponent,
    'recommended-plugins': async () => (await import('../../core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../../core/onboarding/recommended-agents')).recommendedAgentsComponent,
    'capabilities': async () => (await import('../../core/onboarding/recommended-capabilities')).recommendedCapabilitiesComponent,
  }
  const isTTY = Boolean(process.stdout.isTTY)
  const result = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose }, async () => {
    const component = await componentMap[target]()
    return await component.check()
  })
  if (isTTY) {
    await printOnboardingCheckTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
    if (result.remediation) console.log(`  → ${result.remediation}`)
  }
  if (result.status === 'missing' || result.status === 'error' || result.status === 'broken') process.exit(1)
  if (result.status === 'warn') process.exit(2)
}

async function cmdOnboardingCheckAll(options: { verbose?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const results = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose }, async () => {
    const { checkAll } = await import('../../core/onboarding/index')
    return await checkAll()
  })
  if (isTTY) {
    await printOnboardingCheckAllTui(results)
  } else {
    for (const r of results) {
      console.log(`${statusIcon(r.status)} ${r.name.padEnd(10)} ${r.message}`)
      if (r.remediation) console.log(`  → ${r.remediation}`)
    }
  }
  const hasError = results.some(r => r.status === 'error' || r.status === 'missing' || r.status === 'broken')
  const hasWarn = results.some(r => r.status === 'warn')
  process.exit(hasError ? 1 : hasWarn ? 2 : 0)
}

async function cmdOnboardingInstallSingle(target: string, args: string[]): Promise<void> {
  const componentMap: Record<string, () => Promise<import('../../core/onboarding/types').OnboardingComponent>> = {
    search: async () => (await import('../../core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../../core/onboarding/search-models')).searchModelsComponent,
    'plugin-assets': async () => (await import('../../core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-sync': async () => (await import('../../core/onboarding/agent-sync')).agentSyncComponent,
    'recommended-plugins': async () => (await import('../../core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../../core/onboarding/recommended-agents')).recommendedAgentsComponent,
    'capabilities': async () => (await import('../../core/onboarding/recommended-capabilities')).recommendedCapabilitiesComponent,
  }
  const isTTY = Boolean(process.stdout.isTTY)
  const autoApprove = args.includes('--yes')
  const json = args.includes('--json')
  const verbose = args.includes('--verbose')
  const opts = {
    interactive: isTTY && !json,
    autoApprove: autoApprove || (!isTTY && !json),
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY, verbose }, async () => {
    const component = await componentMap[target]()
    return await component.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboard(args: string[]): Promise<void> {
  const { runOnboard, isOnboarded, loadState, COMPONENT_ORDER } = await import('../../core/onboarding/index')
  const { collectOnboardingSelections } = await import('../../core/cli/onboarding-interactive')
  const { OnboardingAlreadyCompleteReport, OnboardingBusy, OnboardingSummary } = await import('../../core/cli/ui/onboarding')
  const { render } = await import('ink')
  const { renderToString } = await import('../../core/cli/ui/render-to-string')
  const { createElement } = await import('react')
  const checkOnly = args.includes('--check')
  const yes = args.includes('--yes')
  const json = args.includes('--json')
  const force = args.includes('--force')
  const verbose = args.includes('--verbose')
  const isTTY = Boolean(process.stdout.isTTY)

  // Early exit for already-onboarded machines unless --force or --check
  if (!force && !checkOnly && isOnboarded()) {
    const state = loadState()
    if (!json && isTTY) {
      console.log(renderToString(createElement(OnboardingAlreadyCompleteReport, { state })))
    } else if (!json) {
      console.log(`[OK] Already onboarded on ${state?.completedAt?.slice(0, 10) ?? 'unknown date'}.`)
      console.log('     Re-run with --force to replay the full flow.')
    } else {
      console.log(JSON.stringify({ status: 'already_onboarded', completedAt: state?.completedAt }))
    }
    process.exit(0)
    return
  }

  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  if (!verbose && previousConsoleFormat === undefined) {
    process.env.BAKIN_CONSOLE_FORMAT = 'silent'
  }

  const baseOpts = {
    interactive: isTTY && !json && !checkOnly,
    autoApprove: yes || (!isTTY && !json),
    json,
    checkOnly,
    force,
  }
  try {
    const selections = await collectOnboardingSelections(baseOpts)
    const opts = { ...baseOpts, ...selections, interactive: false }
    const busyShowsBrand = !selections.renderedWizardScreens

    let busyFrame = 0
    let busyDetail: string | undefined
    const completedOutcomes: Array<{
      name: string
      status: 'complete' | 'warning' | 'skipped' | 'blocked'
      message: string
    }> = []
    let busyTimer: ReturnType<typeof setInterval> | undefined
    const statusForOutcome = (status: 'ok' | 'warn' | 'skipped' | 'error') => {
      if (status === 'ok') return 'complete'
      if (status === 'warn') return 'warning'
      if (status === 'skipped') return 'skipped'
      return 'blocked'
    }
    const renderBusy = () => createElement(OnboardingBusy, {
      label: 'Running onboarding checks and installs',
      detail: busyDetail,
      frame: busyFrame,
      completed: completedOutcomes,
      totalSteps: COMPONENT_ORDER.length,
      showBrand: busyShowsBrand,
    })
    const busy = isTTY && !json
      ? render(renderBusy())
      : null
    if (busy) {
      busyTimer = setInterval(() => {
        busyFrame += 1
        busy.rerender(renderBusy())
      }, 80)
    }

    let result: Awaited<ReturnType<typeof runOnboard>>
    try {
      result = await runOnboard({
        ...opts,
        onProgress: busy
          ? (detail: string) => {
            busyDetail = detail
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
        onOutcome: busy
          ? (outcome) => {
            completedOutcomes.push({
              name: outcome.name,
              status: statusForOutcome(outcome.finalStatus),
              message: outcome.message,
            })
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
      })
    } finally {
      if (busyTimer) clearInterval(busyTimer)
      busy?.unmount()
    }

    if (!json) {
      if (isTTY) {
        console.log('')
        console.log(renderToString(createElement(OnboardingSummary, {
          outcomes: result.outcomes,
          exitCode: result.exitCode,
          showBrand: !busy,
        })))
      } else {
        console.log('')
        for (const o of result.outcomes) {
          console.log(`${statusIcon(o.finalStatus)} ${o.name.padEnd(10)} ${o.message}`)
          if (o.remediation && (o.finalStatus === 'error' || o.finalStatus === 'warn')) {
            console.log(`  → ${o.remediation}`)
          }
        }
        console.log('')
        if (result.exitCode === 0) {
          console.log('Onboarding complete. Run `bakin start` to launch Bakin.')
        } else if (result.exitCode === 2) {
          console.log('Onboarding finished with warnings. Bakin will start but some features may be limited.')
          console.log('Run `bakin start` to launch Bakin.')
        } else {
          console.log('Onboarding failed. Fix the errors above and rerun `bakin onboard`.')
        }
      }
    }

    process.exit(result.exitCode)
  } finally {
    if (!verbose && previousConsoleFormat === undefined) {
      delete process.env.BAKIN_CONSOLE_FORMAT
    }
  }
}


export async function run(args: string[]): Promise<void> {
  const cmd = args[0]
  const sub = args[1]
  if (cmd === 'paths') {
    const flags = args.slice(1)
    const key = flags.find(arg => !arg.startsWith('--'))
    await cmdPaths(key, { json: flags.includes('--json') })
  } else if (cmd === 'mkdir') {
    await cmdOnboardingMkdir({ json: args.includes('--json') })
  } else if (cmd === 'check') {
    if (sub === 'runtime' || sub === 'search' || sub === 'search-models' || sub === 'llm' || sub === 'channels' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents' || sub === 'capabilities') {
      await cmdOnboardingCheckSingle(sub, { verbose: args.includes('--verbose') })
    } else if (sub === 'all') {
      await cmdOnboardingCheckAll({ verbose: args.includes('--verbose') })
    } else {
      await exitUnknownSubcommand('check', sub, ['runtime', 'search', 'search-models', 'llm', 'channels', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents', 'capabilities', 'all'])
    }
  } else if (cmd === 'install') {
    if (sub === 'search' || sub === 'search-models' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents' || sub === 'capabilities') {
      await cmdOnboardingInstallSingle(sub, args)
    } else {
      await exitUnknownSubcommand('install', sub, ['search', 'search-models', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents'])
    }
  } else {
    await cmdOnboard(args)
  }
}
