import { Box, Text } from 'ink'
import { ProgressBar, Spinner } from '@inkjs/ui'
import { Report, type ReportRow } from './report'
import type { ComponentOutcome } from '../../onboarding'

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
              message: outcome.message,
              remediation: outcome.finalStatus === 'error' || outcome.finalStatus === 'warn' ? outcome.remediation : undefined,
            })),
          },
          {
            title: 'Setup',
            rows: setup.map(outcome => ({
              label: outcome.name,
              status: onboardingStatus(outcome.finalStatus),
              message: outcome.message,
              remediation: outcome.finalStatus === 'error' || outcome.finalStatus === 'warn' ? outcome.remediation : undefined,
            })),
          },
        ]}
      />
      <Box flexDirection="column" marginTop={1}>
        {blocker ? (
          <>
            <Text color="red" bold>Onboarding blocked</Text>
            <Text>{blocker.message}</Text>
            {blocker.remediation ? <Text dimColor>{blocker.remediation}</Text> : null}
          </>
        ) : exitCode === 0 ? (
          <Text color="green">Onboarding complete. Run `bakin start` to launch Bakin.</Text>
        ) : (
          <Text color="yellow">Onboarding finished with warnings. Run `bakin doctor` for details.</Text>
        )}
      </Box>
    </Box>
  )
}

export function OnboardingBusy({ label = 'Running onboarding' }: { label?: string }) {
  return <Spinner label={label} />
}

export function OnboardingProgress({ label, value }: { label: string; value: number }) {
  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <ProgressBar value={value} />
    </Box>
  )
}
