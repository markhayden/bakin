import { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { Alert, ProgressBar, Spinner } from '@inkjs/ui'
import { Report, type ReportRow } from './report'
import type { ComponentOutcome } from '../../onboarding'

const ONBOARDING_BUSY_DETAILS = [
  'Checking prerequisites and runtime access',
  'Verifying local search and model dependencies',
  'Installing selected plugins and agents',
  'Writing Bakin configuration and assets',
]

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
    </Box>
  )
}

export function OnboardingBusy({ label = 'Running onboarding', detail, details = ONBOARDING_BUSY_DETAILS }: {
  label?: string
  detail?: string
  details?: string[]
}) {
  const safeDetails = useMemo(() => details.length > 0 ? details : ONBOARDING_BUSY_DETAILS, [details])
  const [detailIndex, setDetailIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setDetailIndex(index => (index + 1) % safeDetails.length)
    }, 1200)

    return () => clearInterval(timer)
  }, [safeDetails.length])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Spinner label={label} />
      <Text dimColor>  {detail ?? safeDetails[detailIndex]}</Text>
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
