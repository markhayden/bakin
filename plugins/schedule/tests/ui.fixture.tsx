import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { SchedulePage } from '../components/schedule-page'

// This deterministic page fixture has no live scheduler or event stream.
window.EventSource = class extends EventTarget { close() {} } as unknown as typeof EventSource

const jobs = [
  { id: 'editorial', displayName: 'Daily editorial review with cross-team approvals and publication checks', humanSchedule: 'Every weekday at 9am', nextRun: '2026-01-16T16:00:00Z', tz: 'America/Denver', paused: false, enabled: true, isBakinJob: true, allowOverlap: false, maxFailures: 3, consecutiveFailures: 0 },
  { id: 'native', displayName: 'Runtime health check', humanSchedule: 'Every hour', paused: true, enabled: true, isBakinJob: false, allowOverlap: false, maxFailures: 3, consecutiveFailures: 2, toolsAllowMissing: true },
]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/schedule?view=list', network: [
      { path: '/api/plugins/schedule/', status: 200, json: { jobs } },
    ] }}
    registrations={[{ id: 'schedule', routes: { '/schedule': SchedulePage } }]}
  />,
)
