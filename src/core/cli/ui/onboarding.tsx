import { Box, Text, useInput } from 'ink'
import { ConfirmInput, Select } from '@inkjs/ui'
import type {
  CheckResult,
  CheckStatus,
  ComponentOutcome,
  InstallResult,
  InstallStatus,
} from '../../onboarding'
import type { SetupChecklist } from '../../onboarding/setup-checklist'
import type { OnboardingState } from '../../onboarding/state'
import {
  FindingRows,
  NextActions,
  ProgressMeter,
  ScreenHeader,
  Section,
  SummaryStrip,
  type FindingRow,
  type SummaryItem,
} from './tui'
import type { TuiStatus } from './style-tokens'

const ONBOARDING_BUSY_DETAILS = [
  'Checking prerequisites and runtime access',
  'Verifying local search and model dependencies',
  'Installing selected plugins and agents',
  'Writing Bakin configuration and assets',
]

const ONBOARDING_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PREREQUISITE_COMPONENTS = new Set(['mkdir', 'settings', 'runtime'])

export type OnboardingBusyStatus = 'complete' | 'warning' | 'skipped' | 'blocked'

export function onboardingStatus(status: ComponentOutcome['finalStatus']): TuiStatus {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'warn':
      return 'warn'
    case 'skipped':
      return 'skip'
    case 'error':
      return 'blocked'
  }
}

function checkStatus(status: CheckStatus): TuiStatus {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'warn':
      return 'warn'
    case 'missing':
    case 'broken':
    case 'error':
      return 'blocked'
  }
}

function installStatus(status: InstallStatus): TuiStatus {
  switch (status) {
    case 'installed':
      return 'applied'
    case 'noop':
      return 'ok'
    case 'skipped':
      return 'skip'
    case 'failed':
      return 'fail'
  }
}

function busyStatus(status: OnboardingBusyStatus): TuiStatus {
  switch (status) {
    case 'complete':
      return 'ok'
    case 'warning':
      return 'warn'
    case 'skipped':
      return 'skip'
    case 'blocked':
      return 'blocked'
  }
}

function checkSummary(results: CheckResult[]): SummaryItem[] {
  const ok = results.filter(result => result.status === 'ok').length
  const warnings = results.filter(result => result.status === 'warn').length
  const blocked = results.filter(result => result.status === 'missing' || result.status === 'broken' || result.status === 'error').length
  return [
    { label: 'ready', value: ok, status: 'ok' },
    { label: 'attention', value: warnings, status: warnings > 0 ? 'warn' : 'ok' },
    { label: 'blocked', value: blocked, status: blocked > 0 ? 'blocked' : 'ok' },
  ]
}

function summarySubtitle(exitCode: 0 | 1 | 2): string {
  if (exitCode === 0) return 'Machine setup complete'
  if (exitCode === 2) return 'Machine setup completed with warnings'
  return 'Machine setup blocked'
}

function summaryItems(outcomes: ComponentOutcome[]): SummaryItem[] {
  const complete = outcomes.filter(outcome => outcome.finalStatus === 'ok').length
  const warnings = outcomes.filter(outcome => outcome.finalStatus === 'warn').length
  const skipped = outcomes.filter(outcome => outcome.finalStatus === 'skipped').length
  const blocked = outcomes.filter(outcome => outcome.finalStatus === 'error').length
  const attention = warnings + skipped

  return [
    { label: 'complete', value: complete, status: 'ok' },
    { label: 'attention', value: attention, status: warnings > 0 ? 'warn' : skipped > 0 ? 'skip' : 'ok' },
    { label: 'blocked', value: blocked, status: blocked > 0 ? 'blocked' : 'ok' },
  ]
}

function checkRows(results: CheckResult[]): FindingRow[] {
  return results.map(result => ({
    status: checkStatus(result.status),
    label: result.name,
    message: formatOnboardingMessage(result.message),
    detail: result.remediation ? formatOnboardingMessage(result.remediation) : undefined,
  }))
}

function outcomeRows(outcomes: ComponentOutcome[]): FindingRow[] {
  return outcomes.map(outcome => ({
    status: onboardingStatus(outcome.finalStatus),
    label: outcome.name,
    message: formatOnboardingMessage(outcome.message),
    detail: outcome.remediation ? formatOnboardingMessage(outcome.remediation) : undefined,
  }))
}

export function OnboardingCheckReport({ result, color = true }: {
  result: CheckResult
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboarding check" subtitle="Component setup checked" meta={result.name} color={color} />
      <SummaryStrip items={[
        { label: 'component', value: result.name, status: checkStatus(result.status) },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={checkRows([result])} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function OnboardingCheckAllReport({ results, color = true }: {
  results: CheckResult[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboarding checks" subtitle="Setup components checked" color={color} />
      <SummaryStrip items={checkSummary(results)} color={color} />
      <Section title="Checks" color={color}>
        <FindingRows rows={checkRows(results)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

export function OnboardingInstallReport({ result, color = true }: {
  result: InstallResult
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboarding install" subtitle="Component setup applied" meta={result.name} color={color} />
      <SummaryStrip items={[
        { label: 'component', value: result.name, status: installStatus(result.status) },
        { label: 'elapsed', value: `${result.durationMs}ms` },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={[{
          status: installStatus(result.status),
          label: result.name,
          message: formatOnboardingMessage(result.message),
          detail: result.error ? String(result.error) : undefined,
        }]} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}

const CHECKLIST_STATUS: Record<SetupChecklist['items'][number]['state'], TuiStatus> = { done: 'done', todo: 'todo', unknown: 'skip' }

/** Where an item is done: the command that does it, or the page it is done on. */
function checklistNext(entry: { command?: string; href?: string }): string | undefined {
  if (entry.command) return `Run \`${entry.command}\`.`
  if (entry.href) return `In the browser: ${entry.href}`
  return undefined
}

/**
 * The setup checklist as plain lines, for output that is not a terminal:
 * `[x]` done, `[ ]` to do, `[?]` could not be told, then the next steps.
 */
export function checklistLines(checklist: SetupChecklist): string[] {
  const mark = { done: '[x]', todo: '[ ]', unknown: '[?]' } as const
  const lines = ['Setup checklist:']
  for (const item of checklist.items) {
    lines.push(`  ${mark[item.state]} ${item.title} — ${item.detail}`)
    const next = item.state === 'done' ? undefined : checklistNext(item)
    if (next) lines.push(`        ${next}`)
  }
  if (checklist.notes.length > 0) {
    lines.push('Next:')
    for (const note of checklist.notes) lines.push(`  - ${note.title}: ${note.detail}${checklistNext(note) ? ` ${checklistNext(note)}` : ''}`)
  }
  return lines
}

/** What is left to set up, and what is already in place. */
export function OnboardingChecklist({ checklist }: { checklist: SetupChecklist }) {
  const todo = checklist.items.filter((item) => item.state !== 'done')
  const done = checklist.items.filter((item) => item.state === 'done')
  return (
    <Box flexDirection="column">
      <Section title="Setup checklist">
        {checklist.items.length === 0 ? <Text dimColor>Nothing else to set up.</Text> : null}
        <FindingRows rows={[...todo, ...done].map((item) => ({
          status: CHECKLIST_STATUS[item.state],
          label: item.title,
          message: item.detail,
          ...(item.state !== 'done' && checklistNext(item) ? { next: checklistNext(item) } : {}),
        }))} />
      </Section>
      <NextActions actions={checklist.notes.map((note) => `${note.title}: ${note.detail}${checklistNext(note) ? ` ${checklistNext(note)}` : ''}`)} />
    </Box>
  )
}

export function OnboardingSummary({ outcomes, exitCode, showBrand = true, checklist }: {
  outcomes: ComponentOutcome[]
  exitCode: 0 | 1 | 2
  showBrand?: boolean
  /** What is left to set up. Shown instead of the generic next step when the run was not blocked. */
  checklist?: SetupChecklist
}) {
  const prerequisites = outcomes.filter(outcome => PREREQUISITE_COMPONENTS.has(outcome.name))
  const setup = outcomes.filter(outcome => !PREREQUISITE_COMPONENTS.has(outcome.name))

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboarding" subtitle={summarySubtitle(exitCode)} showBrand={showBrand} />
      <SummaryStrip items={summaryItems(outcomes)} />
      <Section title="Prerequisites">
        <FindingRows rows={outcomeRows(prerequisites)} />
      </Section>
      {setup.length > 0 ? (
        <Section title="Setup">
          <FindingRows rows={outcomeRows(setup)} />
        </Section>
      ) : null}
      {checklist && exitCode !== 1
        ? <OnboardingChecklist checklist={checklist} />
        : <OnboardingFinalStatus outcomes={outcomes} exitCode={exitCode} />}
    </Box>
  )
}

export function OnboardingFinalStatus({ outcomes, exitCode }: {
  outcomes: ComponentOutcome[]
  exitCode: 0 | 1 | 2
}) {
  const blocker = outcomes.find(outcome => outcome.finalStatus === 'error')
  const actions = blocker
    ? [blocker.remediation ? 'Rerun `bakin onboard` after the blocker is resolved.' : 'Fix the blocked item above, then rerun `bakin onboard`.']
    : exitCode === 0
      ? ['Run `bakin start` to launch Bakin.']
      : ['Run `bakin start`, then `bakin doctor` for details.']

  return <NextActions actions={actions} />
}

export function OnboardingBusy({ label = 'Running onboarding', detail, frame = 0, details = ONBOARDING_BUSY_DETAILS, completed, totalSteps = 1, showBrand = true }: {
  label?: string
  detail?: string
  frame?: number
  details?: string[]
  completed?: Array<{
    name: string
    status: OnboardingBusyStatus
    message: string
  }>
  totalSteps?: number
  showBrand?: boolean
}) {
  const safeDetails = details.length > 0 ? details : ONBOARDING_BUSY_DETAILS
  const spinnerFrame = ONBOARDING_SPINNER_FRAMES[frame % ONBOARDING_SPINNER_FRAMES.length]
  const fallbackDetail = safeDetails[Math.floor(frame / 12) % safeDetails.length]
  const currentStep = Math.max(1, Math.min(completed?.length ? completed.length + 1 : 1, totalSteps))
  const boundedTotalSteps = Math.max(totalSteps, currentStep)
  const prerequisites = completed?.filter(item => PREREQUISITE_COMPONENTS.has(item.name)) ?? []
  const setup = completed?.filter(item => !PREREQUISITE_COMPONENTS.has(item.name)) ?? []
  const rows = [...prerequisites, ...setup].map(item => ({
    status: busyStatus(item.status),
    label: item.name,
    message: formatOnboardingMessage(item.message),
  }))
  const warnings = completed?.filter(item => item.status === 'warning').length ?? 0
  const skipped = completed?.filter(item => item.status === 'skipped').length ?? 0
  const blocked = completed?.filter(item => item.status === 'blocked').length ?? 0
  const attention = warnings + skipped + blocked
  const percent = Math.round((currentStep / boundedTotalSteps) * 100)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle="Interactive setup in progress" meta={`step ${currentStep} of ${boundedTotalSteps}`} showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'complete', value: completed?.filter(item => item.status === 'complete').length ?? 0, status: 'ok' },
        { label: 'running', value: 1, status: 'run' },
        { label: 'attention', value: attention, status: blocked > 0 ? 'blocked' : warnings > 0 ? 'warn' : skipped > 0 ? 'skip' : 'ok' },
      ]} />
      <Section title="Progress">
        <ProgressMeter label="Setting up this machine" current={currentStep} total={boundedTotalSteps} percent={percent} />
        {rows.length > 0 ? (
          <Box marginTop={1}>
            <FindingRows rows={rows} />
          </Box>
        ) : null}
      </Section>
      <Section title="Current activity">
        <FindingRows rows={[{
          status: 'run',
          label: spinnerFrame,
          message: label,
          detail: detail ?? fallbackDetail,
        }]} />
      </Section>
    </Box>
  )
}

export function OnboardingProgress({ label, value }: { label: string; value: number }) {
  return (
    <ProgressMeter label={label} current={value} total={100} percent={value} />
  )
}

export function OnboardingIntro() {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle="Initial setup wizard" />
      <SummaryStrip items={[
        { label: 'mode', value: 'interactive', status: 'ready' },
        { label: 'checks', value: 'prerequisites' },
        { label: 'setup', value: 'plugins and agents' },
      ]} />
      <Section title="Flow">
        <FindingRows rows={[
          { status: 'ready', label: 'review', message: 'Confirm missing prerequisites before installation.' },
          { status: 'ready', label: 'select', message: 'Choose official plugins and agents to install or adopt.' },
          { status: 'run', label: 'apply', message: 'Run setup steps and stream progress as each component finishes.' },
        ]} />
      </Section>
    </Box>
  )
}

export function OnboardingRequiredReport({ color = true }: { color?: boolean }) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle="Initial setup required" color={color} />
      <SummaryStrip items={[
        { label: 'start', value: 'blocked', status: 'blocked' },
        { label: 'setup', value: 'required', status: 'ready' },
      ]} color={color} />
      <Section title="Required setup" color={color}>
        <FindingRows rows={[
          {
            status: 'blocked',
            label: 'onboarding',
            message: 'Bakin has not been onboarded on this machine.',
            detail: 'Run `bakin onboard` to complete setup before starting the server.',
          },
          {
            status: 'ready',
            label: 'readiness',
            message: 'Run `bakin onboard --check` to inspect readiness without changing anything.',
          },
        ]} color={color} />
      </Section>
      <NextActions actions={[
        'Run `bakin onboard` to complete first-run setup.',
        'Run `bakin onboard --check` to inspect readiness without changing anything.',
      ]} color={color} />
    </Box>
  )
}

export function OnboardingAlreadyCompleteReport({ state, color = true }: {
  state: OnboardingState | null
  color?: boolean
}) {
  const completedAt = state?.completedAt?.slice(0, 10) ?? 'unknown date'
  const componentCount = Object.keys(state?.components ?? {}).length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboarding" subtitle="Machine setup already complete" meta={`completed: ${completedAt}`} color={color} />
      <SummaryStrip items={[
        { label: 'status', value: 'ready', status: 'ok' },
        { label: 'components', value: componentCount, status: componentCount > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={[
          {
            status: 'ok',
            label: 'onboarded',
            message: `Already onboarded on ${completedAt}.`,
            detail: state?.bakinVersion ? `Bakin version: ${state.bakinVersion}` : undefined,
          },
          {
            status: 'ready',
            label: 'replay',
            message: 'Re-run with `--force` to replay the full onboarding flow.',
          },
        ]} color={color} />
      </Section>
      <NextActions actions={[
        'Run `bakin start` to launch Bakin.',
        'Run `bakin onboard --force` to replay first-run setup.',
      ]} color={color} />
    </Box>
  )
}

export function OnboardingDecisionPrompt({ title, description, defaultChoice, showBrand = true, onSubmit }: {
  title: string
  description: string
  defaultChoice: 'confirm' | 'cancel'
  showBrand?: boolean
  onSubmit: (approved: boolean) => void
}) {
  const defaultLabel = defaultChoice === 'confirm' ? 'Yes' : 'No'
  const defaultHint = defaultChoice === 'confirm'
    ? 'Default: Yes. Press Enter or y to continue; press n to skip.'
    : 'Default: No. Press y to continue; press Enter or n to skip.'

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle="Interactive setup decision" meta={title.toLowerCase()} showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'decision', value: 1, status: 'warn' },
        { label: 'default', value: defaultLabel, status: defaultChoice === 'confirm' ? 'ready' : 'skip' },
      ]} />
      <Section title="Decision">
        <FindingRows rows={[{
          status: 'warn',
          label: title,
          message: description,
        }]} />
        <Box marginTop={1}>
          <Text bold>Continue? </Text>
          <ConfirmInput
            defaultChoice={defaultChoice}
            onConfirm={() => onSubmit(true)}
            onCancel={() => onSubmit(false)}
          />
        </Box>
        <Text dimColor>{defaultHint}</Text>
      </Section>
    </Box>
  )
}

/**
 * The runtime works but nobody is logged in to a provider. Bakin never
 * handles that secret: this screen says how to log in, in the runtime's own
 * words, and waits. Enter checks again; `s` goes on without a login.
 */
export function OnboardingCredentialsPrompt({ runtimeLabel, steps, docsUrl, attempts = 0, showBrand = true, onSubmit }: {
  /** The runtime's name as people write it. */
  runtimeLabel: string
  /** The runtime's own login steps, in order. */
  steps: readonly string[]
  docsUrl: string
  /** How many times the operator has asked to check again without a login appearing. */
  attempts?: number
  showBrand?: boolean
  onSubmit: (answer: 'recheck' | 'skip') => void
}) {
  useInput((input, key) => {
    if (key.return) onSubmit('recheck')
    else if (input === 's' || input === 'S') onSubmit('skip')
  })
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle={`Log in to ${runtimeLabel}`} meta="credentials" showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'runtime', value: runtimeLabel, status: 'ready' },
        { label: 'logged in', value: 'no', status: 'warn' },
      ]} />
      <Section title="Log in">
        <FindingRows rows={[{
          status: 'warn',
          label: 'credentials',
          message: attempts === 0
            ? `${runtimeLabel} is running, but no provider is logged in yet, so agents cannot run a turn.`
            : `Still no provider logged in to ${runtimeLabel}${attempts > 1 ? ` (checked ${attempts} times)` : ''}.`,
        }]} />
        <Box marginTop={1} flexDirection="column">
          {steps.map((step, index) => (
            <Text key={step}>  {index + 1}. {step}</Text>
          ))}
          <Text dimColor>  Docs: {docsUrl}</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Press Enter when you are logged in</Text>
          <Text>, or </Text>
          <Text bold>s</Text>
          <Text> to finish setup without a login.</Text>
        </Box>
        <Text dimColor>Bakin never sees your credentials. Without a login it starts and waits; agents run once you log in.</Text>
      </Section>
    </Box>
  )
}

export interface RuntimeChoiceOption {
  /** The adapter's id (what is stored). */
  adapter: string
  /** Its name as people write it. */
  label: string
  /** One line on what choosing it means. */
  summary: string
  /** Whether it is already set up on this machine. */
  found: boolean
}

/**
 * First run, and at least one runtime is already set up here: which one
 * should this home use? Every supported runtime is offered; the ones found
 * on this machine are marked, and the first found is what Enter picks.
 */
export function OnboardingRuntimePrompt({ options, preselected, showBrand = true, onSubmit }: {
  options: RuntimeChoiceOption[]
  preselected: string
  showBrand?: boolean
  onSubmit: (adapter: string) => void
}) {
  const found = options.filter((option) => option.found)
  // The list's pointer starts on its first entry and Enter picks whatever
  // it points at, so the preselected runtime goes first. It is NOT passed
  // as the list's default value: the list only reports a CHANGE, so Enter
  // on an entry that is already its value would do nothing at all.
  const ordered = [...options.filter((option) => option.adapter === preselected), ...options.filter((option) => option.adapter !== preselected)]
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Onboard" subtitle="Choose the agent runtime" meta="runtime" showBrand={showBrand} />
      <SummaryStrip items={[
        { label: 'found here', value: found.length, status: 'ready' },
        { label: 'supported', value: options.length, status: 'ready' },
      ]} />
      <Section title="Runtime">
        <FindingRows rows={options.map((option) => ({
          status: option.found ? 'ok' as const : 'skip' as const,
          label: option.label,
          message: `${option.summary} ${option.found ? 'Found on this machine.' : 'Not found on this machine.'}`,
        }))} />
        <Box marginTop={1} flexDirection="column">
          <Text bold>Which runtime should this home use?</Text>
          <Select
            options={ordered.map((option) => ({ label: option.found ? `${option.label} (found)` : option.label, value: option.adapter }))}
            onChange={onSubmit}
          />
        </Box>
        <Text dimColor>Use up/down to move, Enter to choose. This is stored once; change it later with `bakin runtime use`.</Text>
      </Section>
    </Box>
  )
}

function formatOnboardingMessage(message: string): string {
  const home = process.env.HOME
  const compacted = home ? message.replaceAll(home, '~') : message

  return compacted
    .replace(/^Bakin home directory is initialized at (.+)$/, 'Bakin home ready: $1')
    .replace(/^settings\.json is present and parses at (.+)$/, 'settings.json ready: $1')
    .replace(/^All (\d+) Termite models present at (.+)$/, '$1 Termite models ready: $2')
    .replace(/^0 plugin assets to install \(no plugin ships defaults\/runtime-skills\/\)$/, 'No plugin assets to install')
    .replace(/^0 agent-package projections \(no agent or pack installed yet\)$/, 'No agent-package projections yet')
}
