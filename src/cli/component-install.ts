/**
 * One onboarding component install from the CLI (#895 D11): against this
 * home's server when one runs (the operation shows in its tray), in-process
 * otherwise — the same operation either way (`componentInstallOperation`).
 *
 * Ctrl-C:
 * - server mode: once cancels (or says it can't), twice detaches — the
 *   install keeps running on the server;
 * - in-process: once cancels and waits for the install to settle (or says it
 *   can't stop now), twice force-exits — boot recovery checks the install
 *   transactions on the next start.
 */
import { isOperationFinished, type OperationView } from '@makinbakin/sdk/types'
import type { InstallResult } from '../core/onboarding/types'
import type { OnboardingInstallOptions, InstallableComponent as InstallableName } from '../core/onboarding/install-request'
import { CLI_ORIGIN_HEADER, jsonObject, type OperationFollowResult } from './http'
import { currentOperationMode, runInOperationMode, type OperationMode } from './operation-mode'
import { followAndRender, operationExitCode, type OperationRenderer } from './operation-renderer'

export interface ComponentInstallRun {
  /** The component's result, or null when the operation ended without one. */
  result: InstallResult | null
  follow: OperationFollowResult
  exitCode: 0 | 1 | 130
}

type Signals = Pick<NodeJS.Process, 'on' | 'off'>

/** Follows an operation on THIS process's registry until it settles. */
export async function followLocalAndRender(
  operationId: string,
  opts: { renderer: OperationRenderer; signals?: Signals; exit?: (code: number) => never },
): Promise<OperationFollowResult> {
  const { getOperationRegistry, subscribeOperationUpdates } = await import('../core/operations')
  const registry = getOperationRegistry()
  const signals = opts.signals ?? process
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  let latest: OperationView | null = registry.get(operationId)
  if (latest) opts.renderer.update(latest, [])
  const unsubscribe = subscribeOperationUpdates((view) => {
    if (view.id !== operationId || (latest && view.rev <= latest.rev)) return
    latest = view
    opts.renderer.update(view, [])
  })
  let presses = 0
  const onInterrupt = () => {
    presses += 1
    if (presses > 1) {
      opts.renderer.note('Stopped without waiting. The next start checks any install that was interrupted.')
      exit(130)
      return
    }
    if (!latest || isOperationFinished(latest.status)) return
    if (latest.cancellable) {
      registry.cancel(operationId)
      opts.renderer.note('Cancelling… press Ctrl-C again to stop without waiting')
    } else {
      opts.renderer.note("Can't stop now — finishing safely. Press Ctrl-C again to stop without waiting")
    }
  }
  signals.on('SIGINT', onInterrupt)
  try {
    const view = await registry.await(operationId)
    const result: OperationFollowResult = { phase: 'finished', operation: view, children: [] }
    opts.renderer.finish(result)
    return result
  } finally {
    unsubscribe()
    signals.off('SIGINT', onInterrupt)
  }
}

function resultOf(follow: OperationFollowResult): InstallResult | null {
  const body = jsonObject(follow.operation?.result?.body)
  const result = jsonObject(body?.result)
  return result && typeof result.status === 'string' ? result as unknown as InstallResult : null
}

/**
 * Installs one component in the mode D11 picks and renders it with
 * `renderer`. Server refusals (a 4xx before any operation) throw with the
 * server's message.
 */
export async function runComponentInstall(
  name: InstallableName,
  options: OnboardingInstallOptions,
  opts: { renderer: OperationRenderer; mode?: OperationMode; signals?: Signals },
): Promise<ComponentInstallRun> {
  const follow = await runInOperationMode<OperationFollowResult>(opts.mode ?? currentOperationMode(), {
    server: async (target) => {
      const res = await target.fetch('/api/runtime/onboarding/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...CLI_ORIGIN_HEADER },
        body: JSON.stringify({ component: name, options }),
      })
      const body = jsonObject(await res.json().catch(() => null))
      if (!res.ok || typeof body?.operationId !== 'string' || typeof body.bootId !== 'string') {
        const error = typeof body?.error === 'string' ? body.error : `the server answered HTTP ${res.status}`
        throw new Error(`Bakin refused to install ${name}: ${error}`)
      }
      return followAndRender(
        { operationId: body.operationId, bootId: body.bootId },
        { baseUrl: target.baseUrl, renderer: opts.renderer, ...(opts.signals ? { signals: opts.signals } : {}) },
      )
    },
    local: async () => {
      const [{ getOperationRegistry }, { componentInstallOperation }, { installableComponent }] = await Promise.all([
        import('../core/operations'),
        import('../core/onboarding/operation'),
        import('../core/onboarding/index'),
      ])
      const { operationId } = await getOperationRegistry().start(componentInstallOperation(installableComponent(name), options, 'cli'))
      return followLocalAndRender(operationId, { renderer: opts.renderer, ...(opts.signals ? { signals: opts.signals } : {}) })
    },
  })
  return { result: resultOf(follow), follow, exitCode: operationExitCode(follow) }
}
