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
import { COMPONENT_NAMES, INSTALLABLE_COMPONENT_NAMES, isComponentName, isInstallableComponentName, type ComponentName } from '../../core/onboarding/component-names'
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

/**
 * Runtime logs go to stdout. They are kept off it when a person is reading
 * a rendered report (a terminal) and when a program is reading the result
 * (`--json`: the output must parse). `--verbose` and an explicit
 * BAKIN_CONSOLE_FORMAT keep them.
 */
async function withTtyRuntimeLogsSilenced<T>(
  options: { isTTY: boolean; verbose?: boolean; json?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  const shouldSilenceRuntimeLogs = (options.isTTY || options.json === true) && options.verbose !== true && previousConsoleFormat === undefined
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
  const run = await withTtyRuntimeLogsSilenced({ isTTY, verbose: flags.verbose, json: flags.json }, () =>
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

/**
 * A check does not even leave a log line behind: the file log lives in the
 * Bakin home, and writing it would create `~/.bakin/logs/` on a machine
 * that has no home yet. Called before anything in the process can log.
 */
function checkWritesNoLog(): void {
  process.env.BAKIN_DISABLE_FILE_LOG = '1'
}

/**
 * A check changes nothing: compose the check-only services (read-only
 * stores, no secret creation or migration, no provisioning) before any
 * component can reach for the normal ones. This process only checks, so
 * the mode is never switched back.
 */
async function composeForCheck(): Promise<void> {
  checkWritesNoLog()
  const { createCheckAppServices } = await import('../../core/app-services')
  await createCheckAppServices()
}

async function cmdOnboardingCheckSingle(
  target: ComponentName,
  options: { verbose?: boolean; json?: boolean } = {},
): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const result = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose, json: options.json }, async () => {
    await composeForCheck()
    const { checkComponent } = await import('../../core/onboarding/index')
    return await checkComponent(target)
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
  const results = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose, json: options.json }, async () => {
    await composeForCheck()
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
  const { runOnboard, isOnboarded, loadState, COMPONENT_ORDER, OnboardingInterruptedError, RECOMMENDED_COMPONENTS } = await import('../../core/onboarding/index')
  const { collectOnboardingSelections, OnboardingCancelledError, promptRuntimeChoice, waitForCredentials } = await import('../../core/cli/onboarding-interactive')
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

  if (checkOnly) checkWritesNoLog()

  // --check changes nothing and --force clears the marker: there is no run
  // that does both.
  if (checkOnly && force) {
    console.error('bakin onboard: --check and --force cannot be combined. --check reports without changing anything; --force replays setup. Run one or the other.')
    process.exit(1)
  }

  // Which runtime this home uses is decided once, here, before anything
  // else: a flag or an environment value that cannot be honoured is refused
  // even on a home that is already onboarded, and before any write.
  const interactive = isTTY && Boolean(process.stdin.isTTY) && !yes && !json && !checkOnly
  const { chooseRuntime, readRuntimeFlag } = await import('../onboard-runtime')
  const chosen = await chooseRuntime({ flag: readRuntimeFlag(args), interactive, promptRuntimeChoice })
  if (chosen.kind === 'cancelled') {
    console.error('Onboarding cancelled before setup ran. Run `bakin onboard` again when you are ready.')
    process.exit(130)
  }
  if (chosen.kind === 'refused') {
    if (json) {
      const { refusalSummary } = await import('../../core/onboarding/summary')
      console.log(JSON.stringify(refusalSummary(chosen.code, chosen.found)))
    } else {
      console.error(`bakin onboard: ${chosen.message}`)
    }
    process.exit(1)
  }
  // A choice that is not stored in this home (and not already the
  // environment's) applies to this process: every check and install below
  // composes the chosen runtime, the same way the environment override does.
  // The settings step writes it down when the choice is to be kept.
  if (chosen.kind === 'use' && chosen.source !== 'existing' && chosen.source !== 'env') {
    process.env.BAKIN_RUNTIME_ADAPTER = chosen.adapter
    const { resetSettingsCache } = await import('../../core/settings')
    resetSettingsCache()
  }
  const decided = chosen.kind === 'use' ? { adapter: chosen.adapter, source: chosen.source } : undefined
  // One brand per run: whichever screen comes first carries it.
  const runtimeAsked = decided?.source === 'asked'
  const runtimeProposal = chosen.kind === 'use' && chosen.persist ? chosen.adapter : undefined

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
    // The wizard needs a terminal to draw on and a person who did not ask
    // for a scripted run.
    interactive: isTTY && !json && !checkOnly,
    autoApprove: yes || (!isTTY && !json),
    json,
    checkOnly,
    force,
  }
  try {
    if (checkOnly) await composeForCheck()
    const declinedComponents = args.includes('--no-recommended') ? [...RECOMMENDED_COMPONENTS] : []
    const opts = {
      autoApprove: baseOpts.autoApprove,
      json,
      checkOnly,
      force,
      ...(runtimeProposal ? { runtimeProposal } : {}),
      // --no-recommended: set up Bakin itself and nothing from outside.
      ...(declinedComponents.length > 0 ? { declinedComponents } : {}),
    }

    let busyFrame = 0
    let busyDetail: string | undefined
    let busyShowsBrand = true
    let busyFinished = false
    let ranToEnd = false
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
      finished: busyFinished,
    })
    // The busy view starts once the bootstrap phase is done and the wizard
    // (if any) has had the terminal: the wizard's intro carries the brand,
    // so the busy view must know whether to repeat it before it mounts.
    // The bootstrap outcomes are already in the list when it appears.
    let busy: ReturnType<typeof render> | null = null
    let showedBusy = false
    const startBusy = () => {
      if (!isTTY || json || busy) return
      busy = render(renderBusy())
      showedBusy = true
      const live = busy
      busyTimer = setInterval(() => {
        busyFrame += 1
        live.rerender(renderBusy())
      }, 80)
    }
    const stopBusy = () => {
      if (busyTimer) clearInterval(busyTimer)
      busyTimer = undefined
      // A finished run's summary repeats every row, so only the brand
      // stays. A cancelled or interrupted run keeps what it had reached.
      if (ranToEnd) {
        busyFinished = true
        busy?.rerender(renderBusy())
      }
      busy?.unmount()
      busy = null
    }

    // Each install is an operation (#895 D11): on this home's server when
    // one runs, in-process otherwise. The busy view shows its live line;
    // piped runs get plain milestones on stderr; --json stays one line per
    // component.
    const renderer: OperationRenderer = isTTY && !json
      ? {
        update(view) {
          busyDetail = operationStatusLine(view)
          busyFrame += 1
          busy?.rerender(renderBusy())
        },
        note(text) {
          busyDetail = text
          busy?.rerender(renderBusy())
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
    let cancelled = false
    try {
      result = await runOnboard({
        ...opts,
        onOutcome: isTTY && !json
          ? (outcome) => {
            completedOutcomes.push({
              name: outcome.name,
              status: statusForOutcome(outcome.finalStatus),
              message: outcome.message,
            })
            busyFrame += 1
            busy?.rerender(renderBusy())
          }
          : undefined,
      }, installComponent, {
        // The home, the settings and the runtime are in place: now ask.
        // The questions are answered from fresh checks, on a runtime that
        // has already been provisioned by the bootstrap phase.
        afterBootstrap: async (bootstrap) => {
          if (!baseOpts.interactive) {
            if (runtimeAsked) busyShowsBrand = false
            startBusy()
            return undefined
          }
          const runtimeReady = bootstrap.find((outcome) => outcome.name === 'runtime')?.finalStatus === 'ok'
          // The runtime works: is anyone logged in? If not, say how and
          // wait here — no operation is open and no lock is held, so the
          // login can take as long as it takes. Skipping is fine: the run
          // finishes with a warning and Bakin starts without a login.
          let askedForLogin = false
          if (runtimeReady) {
            const { llmComponent } = await import('../../core/onboarding/credentials')
            const { getRuntimeAdapterSupport } = await import('../../core/runtime-adapter-factory')
            const { getSettings } = await import('../../core/settings')
            const support = getRuntimeAdapterSupport(getSettings().runtime.adapter)
            const waited = await waitForCredentials({
              // A check that cannot be read is not a login; the step after this reports it.
              loggedIn: async () => (await llmComponent.check().catch(() => null))?.status === 'ok',
              runtimeLabel: support.label,
              steps: support.loginSteps,
              docsUrl: support.docsUrl,
              // The runtime question already put the brand on screen.
              showBrand: !runtimeAsked,
            })
            askedForLogin = waited.asked
          }
          const selections = await collectOnboardingSelections(baseOpts, { runtimeReady, brandShown: askedForLogin || runtimeAsked, declined: declinedComponents })
          if (selections.renderedWizardScreens || askedForLogin || runtimeAsked) busyShowsBrand = false
          startBusy()
          const { selectedRecommendedPluginIds, selectedRecommendedAgentIds, approvedComponents } = selections
          return { selectedRecommendedPluginIds, selectedRecommendedAgentIds, approvedComponents }
        },
      })
      ranToEnd = true
    } catch (err) {
      if (err instanceof OnboardingCancelledError) cancelled = true
      else if (err instanceof OnboardingInterruptedError) interrupted = err
      else throw err
    } finally {
      stopBusy()
    }
    if (cancelled) {
      // Ctrl-C in the wizard: say so and exit like any interrupted command,
      // never 0 — setup did not finish and no marker was written.
      console.error('Onboarding cancelled before setup finished. Run `bakin onboard` again when you are ready.')
      process.exit(130)
    }
    if (interrupted) {
      const line = `Onboarding stopped at ${interrupted.component}: ${interrupted.message}. Nothing after it ran — rerun \`bakin onboard\` to continue.`
      if (json) console.log(JSON.stringify({ status: 'interrupted', component: interrupted.component, message: interrupted.message }))
      else console.error(line)
      process.exit(130)
    }
    if (!result) return

    // What is left to set up, from the engines that already answer it. A
    // blocked run has one next step, its blocker, so it gets no checklist.
    // The checklist is a courtesy: if it cannot be built the run's result
    // stands and it is simply not shown.
    let checklist: import('../../core/onboarding/setup-checklist').SetupChecklist | undefined
    if (result.exitCode !== 1) {
      try {
        const { getSetupChecklist } = await import('../../core/onboarding/setup-checklist')
        checklist = await getSetupChecklist()
      } catch (err) {
        if (verbose) console.error(`Could not build the setup checklist: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (json) {
      // Always the last line: what the run came to.
      const { runSummary } = await import('../../core/onboarding/summary')
      console.log(JSON.stringify(runSummary(result, decided, chosen.found, checklist)))
    }

    if (!json) {
      if (isTTY) {
        console.log('')
        console.log(renderToString(createElement(OnboardingSummary, {
          outcomes: result.outcomes,
          exitCode: result.exitCode,
          showBrand: !showedBusy,
          ...(checklist ? { checklist } : {}),
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
          console.log(checkOnly ? 'Everything onboarding sets up is in place.' : 'Onboarding complete.')
        } else if (result.exitCode === 2) {
          console.log(checkOnly ? 'Some setup is not done yet; nothing was changed.' : 'Onboarding finished with warnings. Bakin will start but some features may be limited.')
        } else {
          console.log(checkOnly ? 'Setup is blocked by the errors above.' : 'Onboarding failed. Fix the errors above and rerun `bakin onboard`.')
        }
        if (checklist) {
          const { checklistLines } = await import('../../core/cli/ui/onboarding')
          console.log('')
          for (const line of checklistLines(checklist)) console.log(line)
        } else if (result.exitCode !== 1) {
          console.log('Run `bakin start` to launch Bakin.')
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
    // Every onboarding component can be checked by name; the list is the
    // component list, never a second one kept by hand.
    if (isComponentName(sub)) {
      await cmdOnboardingCheckSingle(sub, { verbose: args.includes('--verbose'), json: args.includes('--json') })
    } else if (sub === 'all') {
      await cmdOnboardingCheckAll({ verbose: args.includes('--verbose'), json: args.includes('--json') })
    } else {
      await exitUnknownSubcommand('check', sub, [...COMPONENT_NAMES, 'all'])
    }
  } else if (cmd === 'install') {
    // Every component that has an install can be installed by name.
    if (isInstallableComponentName(sub)) {
      await cmdOnboardingInstallSingle(sub, args)
    } else {
      await exitUnknownSubcommand('install', sub, [...INSTALLABLE_COMPONENT_NAMES])
    }
  } else {
    await cmdOnboard(args)
  }
}
