/**
 * The setup checklist: what is still worth doing after onboarding, in the
 * order someone would do it. Shown on the finish screen and by
 * `bakin onboard --check`.
 *
 * It adds no probing of its own. Every item is a projection of something
 * an existing engine already answers — the credentials check, the search
 * setup check, the channel readiness check, capability readiness, the model
 * plan check — and never of message text. An item is:
 *
 *   done     the engine says it is in place
 *   todo     the engine says there is something to do, and what
 *   unknown  the engine could not answer (it threw, or reported an error)
 *
 * and an item that does not apply to this home is left out entirely: a
 * checklist is not the place to say "nothing to do here".
 *
 * `buildSetupChecklist` is pure; `getSetupChecklist` gathers the sources.
 */
import type { CapabilityReadiness } from '../agent-packages/capability-readiness'
import type { CheckResult } from './types'

export type ChecklistState = 'done' | 'todo' | 'unknown'

export interface ChecklistItem {
  /** Stable id (`login`, `search`, `channels`, `capability-key:<capability>`, `model-plan`). */
  id: string
  title: string
  state: ChecklistState
  /** One line: what is in place, what to do, or why it could not be told. */
  detail: string
  /** A command that does it, when one does. */
  command?: string
  /** Where in the browser it is done, when it is done there. */
  href?: string
}

/** A next step that carries no state: always worth saying, never "done". */
export interface ChecklistNote {
  id: string
  title: string
  detail: string
  command?: string
  href?: string
}

export interface SetupChecklist {
  items: ChecklistItem[]
  notes: ChecklistNote[]
}

/** A source either answered or threw; the reason is kept for the detail line. */
export type Sourced<T> = { ok: true; value: T } | { ok: false; error: string }

export interface SetupChecklistSources {
  /** The active runtime's name as people write it. */
  runtimeLabel: string
  /** `llm` component check: is a provider logged in. */
  llm: Sourced<CheckResult>
  /** `search` component check (the adapter's own setup check, with `applicable`). */
  search: Sourced<CheckResult & { applicable?: boolean }>
  /** `channels` component check (the one channel readiness engine). */
  channels: Sourced<CheckResult>
  /** Capability readiness for every installed capability. */
  capabilities: Sourced<CapabilityReadiness[]>
  /** `models` component check: the model plan. */
  models: Sourced<CheckResult>
  /** Whether a server is running for this home. */
  serverRunning: boolean
}

const KEYS_HREF = '/settings?tab=integrations'
const CHANNELS_HREF = '/settings?tab=channels'

function unknown(id: string, title: string, why: string): ChecklistItem {
  return { id, title, state: 'unknown', detail: `Could not tell: ${why}` }
}

/** A check that answered `error` is an engine that could not answer. */
function answered(source: Sourced<CheckResult>): { check: CheckResult } | { why: string } {
  if (!source.ok) return { why: source.error }
  if (source.value.status === 'error') return { why: source.value.message }
  return { check: source.value }
}

function loginItem(sources: SetupChecklistSources): ChecklistItem {
  const title = `Log in to ${sources.runtimeLabel}`
  const result = answered(sources.llm)
  if ('why' in result) return unknown('login', title, result.why)
  if (result.check.status === 'ok') return { id: 'login', title, state: 'done', detail: result.check.message }
  return { id: 'login', title, state: 'todo', detail: result.check.remediation ?? result.check.message }
}

function searchItem(sources: SetupChecklistSources): ChecklistItem | null {
  const title = 'Search'
  if (!sources.search.ok) return unknown('search', title, sources.search.error)
  const check = sources.search.value
  // Nothing on this machine to set up: an external endpoint, a temporary
  // home, a service another home owns.
  if (check.applicable === false) return null
  if (check.status === 'error') return unknown('search', title, check.message)
  if (check.status === 'ok') return { id: 'search', title, state: 'done', detail: check.message }
  return { id: 'search', title, state: 'todo', detail: check.remediation ?? check.message, command: 'bakin install search' }
}

/** The channel state the readiness engine reported, in either of its modes. */
function channelState(check: CheckResult): string | undefined {
  const state = check.details?.state ?? check.details?.projected
  return typeof state === 'string' ? state : undefined
}

function channelsItem(sources: SetupChecklistSources): ChecklistItem | null {
  const title = 'Channels'
  const result = answered(sources.channels)
  if ('why' in result) return unknown('channels', title, result.why)
  const state = channelState(result.check)
  // The runtime delivers by itself: nothing for Bakin to set up.
  if (state === 'native') return null
  if (state === 'connected' || state === 'ready_to_connect') {
    return { id: 'channels', title, state: 'done', detail: result.check.message }
  }
  if (state === 'disabled') {
    return { id: 'channels', title, state: 'todo', detail: 'Discord delivery is off. Turn it on to get alerts and approvals in a channel.', href: CHANNELS_HREF }
  }
  if (state === undefined) return unknown('channels', title, 'the channel check did not report a state')
  return { id: 'channels', title, state: 'todo', detail: result.check.remediation ?? result.check.message, href: CHANNELS_HREF }
}

function capabilityKeyItems(sources: SetupChecklistSources): ChecklistItem[] {
  if (!sources.capabilities.ok) return [unknown('capability-keys', 'Capability keys', sources.capabilities.error)]
  const items: ChecklistItem[] = []
  for (const capability of sources.capabilities.value) {
    const id = `capability-key:${capability.capability}`
    const title = `${capability.name} key`
    if (!capability.manifestValid) {
      items.push(unknown(id, title, 'its installed manifest is missing or no longer valid'))
      continue
    }
    const required = capability.secrets.filter((secret) => secret.required)
    if (required.length === 0) continue
    const missing = required.filter((secret) => secret.status === 'missing')
    if (missing.length === 0) {
      items.push({ id, title, state: 'done', detail: `${capability.name} has the key it needs.` })
    } else {
      items.push({
        id,
        title,
        state: 'todo',
        detail: `Add ${missing.map((secret) => secret.name).join(', ')} in Settings → Integrations & Keys; ${capability.name} cannot run without ${missing.length === 1 ? 'it' : 'them'}.`,
        href: KEYS_HREF,
      })
    }
  }
  return items
}

function modelPlanItem(sources: SetupChecklistSources): ChecklistItem | null {
  const title = 'Model plan'
  const result = answered(sources.models)
  if ('why' in result) return unknown('model-plan', title, result.why)
  const check = result.check
  if (check.status === 'ok') return { id: 'model-plan', title, state: 'done', detail: check.message }
  // No plan and nothing that can run yet: logging in comes first, and the
  // login item already says so.
  if (check.status === 'missing' && check.details?.candidates === 0) return null
  return { id: 'model-plan', title, state: 'todo', detail: check.message, command: 'bakin models plan --apply' }
}

/** Pure: the checklist that follows from what the engines answered. */
export function buildSetupChecklist(sources: SetupChecklistSources): SetupChecklist {
  const items = [
    loginItem(sources),
    searchItem(sources),
    channelsItem(sources),
    ...capabilityKeyItems(sources),
    modelPlanItem(sources),
  ].filter((item): item is ChecklistItem => item !== null)
  const notes: ChecklistNote[] = []
  if (!sources.serverRunning) {
    notes.push({ id: 'start', title: 'Start Bakin', detail: 'Launch the server and open the dashboard.', command: 'bakin start' })
  }
  notes.push({ id: 'explore', title: 'Browse Explore', detail: 'Add agents, plugins and capabilities whenever you want them.', href: '/explore' })
  return { items, notes }
}

async function sourced<T>(read: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return { ok: true, value: await read() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Ask the existing engines, then project. Reads only. */
export async function getSetupChecklist(): Promise<SetupChecklist> {
  const [{ llmComponent, channelsComponent }, { searchComponent }, { modelsComponent }, { listCapabilities }, { getRuntimeAdapterSupport }, { getSettings }, { readLiveServerLock }] = await Promise.all([
    import('./credentials'),
    import('./search'),
    import('./models'),
    import('../agent-packages/capability-readiness'),
    import('../runtime-adapter-factory'),
    import('../settings'),
    import('../server-lock'),
  ])
  const [llm, search, channels, capabilities, models] = await Promise.all([
    sourced(() => llmComponent.check()),
    sourced(() => searchComponent.check() as Promise<CheckResult & { applicable?: boolean }>),
    sourced(() => channelsComponent.check()),
    sourced(() => listCapabilities()),
    sourced(() => modelsComponent.check()),
  ])
  return buildSetupChecklist({
    runtimeLabel: getRuntimeAdapterSupport(getSettings().runtime.adapter).label,
    llm,
    search,
    channels,
    capabilities,
    models,
    serverRunning: readLiveServerLock() !== null,
  })
}
