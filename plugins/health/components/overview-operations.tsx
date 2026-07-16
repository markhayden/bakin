import type { HealthOverviewViewModel } from '../lib/health-view-model'
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
    <section
      aria-labelledby="overview-operations-title"
      className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card"
      data-testid="overview-operations"
    >
      <h2 id="overview-operations-title" className="sr-only">Operations</h2>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] @[48rem]/health:grid-cols-[minmax(0,1.6fr)_minmax(20rem,.85fr)]">
        <OverviewAgentSpend resource={telemetry.history} model={model} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] border-t border-border/70 @[40rem]/health:grid-cols-2 @[48rem]/health:grid-cols-1 @[48rem]/health:border-l @[48rem]/health:border-t-0">
          <OverviewContextTraffic context={telemetry.context} sessions={telemetry.sessions} />
          <div className="border-t border-border/70 @[40rem]/health:border-l @[40rem]/health:border-t-0 @[48rem]/health:border-l-0 @[48rem]/health:border-t">
            <OverviewInteractions resource={telemetry.interactions} />
          </div>
        </div>
      </div>
    </section>
  )
}
