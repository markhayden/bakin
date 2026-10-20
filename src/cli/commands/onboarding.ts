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
import { createOperationRenderer, describeResult, operationStatusLine, silentOperationRenderer, type OperationRenderer } from '../operation-renderer'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { InstallableComponent as InstallableName, OnboardingInstallOptions } from '../../core/onboarding/install-request'
import type { CheckResult, InstallableComponent, InstallResult } from '../../core/onboarding/types'

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

/** The progress renderer for a single install: live on a TTY, plain milestones on stderr when piped, silent for --json. */
function singleInstallRenderer(json: boolean, isTTY: boolean): OperationRenderer {
  if (json) return silentOperationRenderer()
  return isTTY
    ? createOperationRenderer({ mode: 'tty', write: (text) => { process.stdout.write(text) } })
    : createOperationRenderer({ mode: 'plain', write: (text) => { process.stderr.write(text) } })
}

/**
 * One component install as an operation (#895 D11) — on this home's server
 * when one runs, in-process otherwise — then the command's result card.
 */
async function installAndReport(name: InstallableName, options: OnboardingInstallOptions, flags: { json: boolean; verbose?: boolean }): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const { runComponentInstall } = await import('../component-install')
  const run = await withTtyRuntimeLogsSilenced({ isTTY, verbose: flags.verbose }, () =>
    runComponentInstall(name, options, { renderer: singleInstallRenderer(flags.json, isTTY) }))
  const result: InstallResult = run.result ?? { name, status: 'failed', message: describeResult(run.follow), durationMs: 0 }
  if (flags.json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (run.exitCode === 130) process.exit(130)
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingMkdir(options: { json?: boolean } = {}): Promise<void> {
  await installAndReport('mkdir', { autoApprove: true, allowServiceClaim: false }, { json: options.json === true })
}

export async function cmdOnboardingSettingsInit(options: { json?: boolean } = {}): Promise<void> {
  await installAndReport('settings', { autoApprove: true, allowServiceClaim: false }, { json: options.json === true })
}

async function cmdOnboardingCheckSingle(
  target: 'runtime' | 'search' | 'search-models' | 'media' | 'llm' | 'models' | 'channels' | 'plugin-assets' | 'agent-sync' | 'recommended-plugins' | 'recommended-agents' | 'capabilities',
  options: { verbose?: boolean; json?: boolean } = {},
): Promise<void> {
  const componentMap: Record<string, () => Promise<{ check(): Promise<import('../../core/onboarding/types').CheckResult> }>> = {
    runtime: async () => (await import('../../core/onboarding/runtime')).runtimeComponent,
    search: async () => (await import('../../core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../../core/onboarding/search-models')).searchModelsComponent,
    media: async () => (await import('../../core/onboarding/media')).mediaComponent,
    llm: async () => (await import('../../core/onboarding/credentials')).llmComponent,
    models: async () => (await import('../../core/onboarding/models')).modelsComponent,
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
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (isTTY) {
    await printOnboardingCheckTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
    if (result.remediation) console.log(`  → ${result.remediation}`)
  }
  if (result.status === 'missing' || result.status === 'error' || result.status === 'broken') process.exit(1)
  if (result.status === 'warn') process.exit(2)
}

async function cmdOnboardingCheckAll(options: { verbose?: boolean; json?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const results = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose }, async () => {
    const { checkAll } = await import('../../core/onboarding/index')
    return await checkAll()
  })
  if (options.json) {
    console.log(JSON.stringify(results, null, 2))
  } else if (isTTY) {
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

async function cmdOnboardingInstallSingle(target: InstallableName, args: string[]): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const json = args.includes('--json')
  const verbose = args.includes('--verbose')
  // Piped without --json is a script asking for the install (as before);
  // a terminal without --yes is asked here, before anything starts — the
  // operation itself never prompts (#895 D11).
  let autoApprove = args.includes('--yes') || (!isTTY && !json)
  if (!autoApprove && isTTY && !json) {
    const { askYesNo } = await import('../../core/onboarding/prompts')
    // An explicit BAKIN_URL installs on ANOTHER home — this machine's check
    // says nothing about it, so ask by name instead of from local state.
    const remote = process.env.BAKIN_URL
    const question = remote
      ? `Install ${target} on the Bakin at ${remote}?`
      : await (async () => {
        const { installableComponent } = await import('../../core/onboarding/index')
        const check = await withTtyRuntimeLogsSilenced({ isTTY, verbose }, () => installableComponent(target).check())
        return check.status === 'ok' ? null : `${check.message.replace(/\.$/, '')}. Install ${target} now?`
      })()
    if (question && !await askYesNo(question, true)) {
      // Declined: nothing starts — not every installer gates on approval.
      await printOnboardingInstallTui({ name: target, status: 'skipped', message: `Skipped — run \`bakin install ${target}\` when you're ready.`, durationMs: 0 })
      return
    }
    // Asked and accepted, or the check found nothing to ask about: the typed
    // command is the approval either way, so an installer that still finds
    // work never skips it as "not approved".
    autoApprove = true
  }
  await installAndReport(target, {
    autoApprove,
    // `bakin install search` is the explicit claim of the search service
    // for this home; the server honours it only with this home's lock secret.
    allowServiceClaim: target === 'search',
  }, { json, verbose })
}

async function cmdOnboard(args: string[]): Promise<void> {
  // Onboarding checks, provisions and marks THIS home; installs go to this
  // home's own server (via its server.lock) or run in-process. An explicit
  // BAKIN_URL targets some other server, whose home these checks don't see.
  if (process.env.BAKIN_URL) {
    const { getContentDir } = await import('../../core/content-dir')
    console.error(`bakin onboard sets up this machine's Bakin home (${getContentDir()}), but BAKIN_URL points at ${process.env.BAKIN_URL}. Unset BAKIN_URL and run it again — it uses this home's own server when one is running.`)
    process.exit(1)
  }
  const { runOnboard, isOnboarded, loadState, COMPONENT_ORDER, OnboardingInterruptedError } = await import('../../core/onboarding/index')
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
    const opts = { autoApprove: baseOpts.autoApprove, json, checkOnly, force, ...selections }
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

    // Each install is an operation (#895 D11): on this home's server when
    // one runs, in-process otherwise. The busy view shows its live line;
    // piped runs get plain milestones on stderr; --json stays one line per
    // component.
    const renderer: OperationRenderer = busy
      ? {
        update(view) {
          busyDetail = operationStatusLine(view)
          busyFrame += 1
          busy.rerender(renderBusy())
        },
        note(text) {
          busyDetail = text
          busy.rerender(renderBusy())
        },
        finish() {},
      }
      : json
        ? silentOperationRenderer()
        : createOperationRenderer({ mode: 'plain', write: (text) => { process.stderr.write(text) } })
    const { runComponentInstall } = await import('../component-install')
    const installComponent = async (component: InstallableComponent, options: OnboardingInstallOptions): Promise<InstallResult> => {
      const run = await runComponentInstall(component.name as InstallableName, options, { renderer })
      // Ctrl-C (cancelled, or detached from a server run) stops onboarding, not just this step.
      if (run.exitCode === 130) throw new OnboardingInterruptedError(component.name, describeResult(run.follow))
      return run.result ?? { name: component.name, status: 'failed', message: describeResult(run.follow), durationMs: 0 }
    }

    let result: Awaited<ReturnType<typeof runOnboard>> | undefined
    let interrupted: InstanceType<typeof OnboardingInterruptedError> | null = null
    try {
      result = await runOnboard({
        ...opts,
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
      }, installComponent)
    } catch (err) {
      if (!(err instanceof OnboardingInterruptedError)) throw err
      interrupted = err
    } finally {
      if (busyTimer) clearInterval(busyTimer)
      busy?.unmount()
    }
    if (interrupted) {
      const line = `Onboarding stopped at ${interrupted.component}: ${interrupted.message}. Nothing after it ran — rerun \`bakin onboard\` to continue.`
      if (json) console.log(JSON.stringify({ status: 'interrupted', component: interrupted.component, message: interrupted.message }))
      else console.error(line)
      process.exit(130)
    }
    if (!result) return

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
    if (sub === 'runtime' || sub === 'search' || sub === 'search-models' || sub === 'media' || sub === 'llm' || sub === 'models' || sub === 'channels' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents' || sub === 'capabilities') {
      await cmdOnboardingCheckSingle(sub, { verbose: args.includes('--verbose'), json: args.includes('--json') })
    } else if (sub === 'all') {
      await cmdOnboardingCheckAll({ verbose: args.includes('--verbose'), json: args.includes('--json') })
    } else {
      await exitUnknownSubcommand('check', sub, ['runtime', 'search', 'search-models', 'media', 'llm', 'models', 'channels', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents', 'capabilities', 'all'])
    }
  } else if (cmd === 'install') {
    if (sub === 'search' || sub === 'search-models' || sub === 'media' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents' || sub === 'capabilities') {
      await cmdOnboardingInstallSingle(sub, args)
    } else {
      await exitUnknownSubcommand('install', sub, ['search', 'search-models', 'media', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents'])
    }
  } else {
    await cmdOnboard(args)
  }
}
