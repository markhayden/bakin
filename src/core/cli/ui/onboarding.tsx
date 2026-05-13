import { Box, Text } from 'ink'
import { Alert, ProgressBar } from '@inkjs/ui'
import { BAKIN_PINK, Report, type ReportRow } from './report'
import { StatusBadge } from './status'
import type { ComponentOutcome } from '../../onboarding'

const ONBOARDING_BUSY_DETAILS = [
  'Checking prerequisites and runtime access',
  'Verifying local search and model dependencies',
  'Installing selected plugins and agents',
  'Writing Bakin configuration and assets',
]

const ONBOARDING_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function onboardingStatus(status: ComponentOutcome['finalStatus']): ReportRow['status'] {
  switch (status) {
    case 'ok':
      return 'complete'
    case 'warn':
      return 'warning'
    case 'skipped':
      return 'skipped'
    case 'error':
      return 'blocked'
  }
}

export function OnboardingSummary({ outcomes, exitCode }: {
  outcomes: ComponentOutcome[]
  exitCode: 0 | 1 | 2
}) {
  const blocker = outcomes.find(outcome => outcome.finalStatus === 'error')
  const prerequisites = outcomes.filter(outcome => ['mkdir', 'settings', 'runtime'].includes(outcome.name))
  const setup = outcomes.filter(outcome => !['mkdir', 'settings', 'runtime'].includes(outcome.name))

  return (
    <Box flexDirection="column">
      <Report
        title="Bakin onboarding"
        groups={[
          {
            title: 'Prerequisites',
            rows: prerequisites.map(outcome => ({
              label: outcome.name,
              status: onboardingStatus(outcome.finalStatus),
              message: formatOnboardingMessage(outcome.message),
              remediation: outcome.finalStatus === 'error' || outcome.finalStatus === 'warn' ? outcome.remediation : undefined,
            })),
          },
          {
            title: 'Setup',
            rows: setup.map(outcome => ({
              label: outcome.name,
              status: onboardingStatus(outcome.finalStatus),
              message: formatOnboardingMessage(outcome.message),
              remediation: outcome.finalStatus === 'error' || outcome.finalStatus === 'warn' ? outcome.remediation : undefined,
            })),
          },
        ]}
      />
      <OnboardingFinalStatus outcomes={outcomes} exitCode={exitCode} />
    </Box>
  )
}

export function OnboardingFinalStatus({ outcomes, exitCode }: {
  outcomes: ComponentOutcome[]
  exitCode: 0 | 1 | 2
}) {
  const blocker = outcomes.find(outcome => outcome.finalStatus === 'error')

  return (
    <Box flexDirection="column" marginTop={1}>
      {blocker ? (
        <Alert variant="error" title="Onboarding blocked">
          {blocker.remediation ? `${blocker.message}\n${blocker.remediation}` : blocker.message}
        </Alert>
      ) : exitCode === 0 ? (
        <Alert variant="success">Onboarding complete. Run `bakin start` to launch Bakin.</Alert>
      ) : (
        <Alert variant="warning">Onboarding finished with warnings. Run `bakin doctor` for details.</Alert>
      )}
    </Box>
  )
}

export function OnboardingBusy({ label = 'Running onboarding', detail, frame = 0, details = ONBOARDING_BUSY_DETAILS, completed }: {
  label?: string
  detail?: string
  frame?: number
  details?: string[]
  completed?: Array<{
    name: string
    status: ReportRow['status']
    message: string
  }>
}) {
  const safeDetails = details.length > 0 ? details : ONBOARDING_BUSY_DETAILS
  const spinnerFrame = ONBOARDING_SPINNER_FRAMES[frame % ONBOARDING_SPINNER_FRAMES.length]
  const fallbackDetail = safeDetails[Math.floor(frame / 12) % safeDetails.length]
  const prerequisites = completed?.filter(item => ['mkdir', 'settings', 'runtime'].includes(item.name)) ?? []
  const setup = completed?.filter(item => !['mkdir', 'settings', 'runtime'].includes(item.name)) ?? []

  return (
    <Box flexDirection="column" marginTop={1}>
      {completed && completed.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {prerequisites.length > 0 ? (
            <CompletedGroup title="Prerequisites" rows={prerequisites} />
          ) : null}
          {setup.length > 0 ? (
            <CompletedGroup title="Setup" rows={setup} marginTop={prerequisites.length > 0 ? 1 : 0} />
          ) : null}
        </Box>
      ) : null}
      <Box>
        <Text color={BAKIN_PINK}>{spinnerFrame}</Text>
        <Text bold> {label}</Text>
      </Box>
      <Text dimColor>  {detail ?? fallbackDetail}</Text>
    </Box>
  )
}

function CompletedGroup({ title, rows, marginTop = 0 }: {
  title: string
  rows: Array<{
    name: string
    status: ReportRow['status']
    message: string
  }>
  marginTop?: number
}) {
  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text color={BAKIN_PINK} bold>{title}</Text>
      {rows.map(item => (
        <Box key={item.name}>
          <StatusBadge status={item.status} />
          <Text> {item.name.padEnd(18)} {formatOnboardingMessage(item.message)}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function OnboardingProgress({ label, value }: { label: string; value: number }) {
  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <ProgressBar value={value} />
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
    .replace(/^mcporter is installed and configured at (.+)$/, 'mcporter ready: $1')
    .replace(/^0 plugin assets to install \(no plugin ships defaults\/runtime-skills\/\)$/, 'No plugin assets to install')
    .replace(/^0 agent-package projections \(no agent or pack installed yet\)$/, 'No agent-package projections yet')
}
