import type { HealthOverviewViewModel } from '../lib/health-view-model'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import { Text } from '@makinbakin/sdk/ui'
import { OverviewAgentSpend } from './overview-agent-spend'
import { OverviewContextTraffic } from './overview-context-traffic'
import { OverviewInteractions } from './overview-interactions'
import type { OverviewTelemetry } from './overview-telemetry'

export function OverviewOperations({
  model,
  telemetry,
}: {
  model: HealthOverviewViewModel
  telemetry: OverviewTelemetry
}) {
  return (
    <Section
      aria-labelledby="overview-operations-title"
      divider="top"
      spacing="compact"
      data-layout="operational-telemetry"
      data-testid="overview-operations"
    >
      <Stack gap="dense">
        <h2 id="overview-operations-title">Operating telemetry</h2>
        <Text size="meta" tone="muted" as="p" className="leading-relaxed">
          Token use, context pressure, cache efficiency, and recorded interactions.
        </Text>
      </Stack>
      <Grid layout="main-aside" gap="section" align="start">
        <OverviewAgentSpend resource={telemetry.history} model={model} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-bakin-6 @[40rem]/health:grid-cols-2 @[48rem]/health:grid-cols-1">
          <OverviewContextTraffic context={telemetry.context} sessions={telemetry.sessions} />
          <OverviewInteractions resource={telemetry.interactions} />
        </div>
      </Grid>
    </Section>
  )
}
