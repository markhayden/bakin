import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { UpdatesTabView } from '../components/updates-tab'
import type { UseUpdatesActionsResult } from '../hooks/use-updates'
import type { UpdatesData } from '../lib/updates-route-schema'

const NOW = Date.parse(DEFAULT_PLUGIN_UI_FIXTURE.fixedNow)
const CHECKED_AT = new Date(NOW - 7 * 60_000).toISOString()
const FAILED_AT = new Date(NOW - 3 * 3_600_000).toISOString()

function record(over: Partial<UpdateRecord> & Pick<UpdateRecord, 'id' | 'subject'>): UpdateRecord {
  return { group: 'available', outcome: 'update-available', source: { kind: 'test', endpoint: 'fixture' }, fingerprint: 'fp', observedAt: CHECKED_AT, attempt: { at: CHECKED_AT }, ...over }
}

// Every row state the tab renders: required (engine pin + a blocked model), available
// (a Bakin release with notes, a plugin rebuild with a long label, a manual pointer),
// a check that never succeeded, and a skipped release that stays hidden by default.
const records: UpdateRecord[] = [
  record({ id: 'search-engine:antfly', group: 'required', subject: { kind: 'search-engine', id: 'antfly', label: 'Search engine' },
    installed: { version: '0.1.9', display: 'v0.1.9' }, available: { version: '0.2.5', display: 'v0.2.5' }, reason: 'pin-mismatch',
    action: { kind: 'operation', start: { route: '/api/updates/search-engine%3Aantfly/apply' }, impact: ['download', 'search-interruption', 'reindex'], downloadBytes: 48_300_000 } }),
  record({ id: 'search-models:antfly', group: 'required', subject: { kind: 'search-models', id: 'antfly', label: 'Search models' }, outcome: 'blocked',
    installed: { display: '2 of 3 models' }, blockedReason: 'bge-m3 is not installable here — the configured variant is not published for darwin/arm64.',
    action: { kind: 'manual', pointer: 'Change the search model configuration.' } }),
  record({ id: 'bakin:bakin', subject: { kind: 'bakin', id: 'bakin', label: 'Bakin' },
    installed: { version: '0.3.5', display: 'v0.3.5' }, available: { version: '0.3.6', display: 'v0.3.6' }, reason: 'newer-version', notesUrl: 'https://example.test/releases/v0.3.6',
    action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } }),
  record({ id: 'plugin:editorial', subject: { kind: 'plugin', id: 'editorial', label: 'Editorial publishing and cross-channel approval connector' },
    installed: { version: '1.4.0', display: '1.4.0' }, available: { version: '1.4.0', display: '1.4.0 (rebuilt for this Bakin)' }, reason: 'compatible-rebuild',
    action: { kind: 'operation', start: { route: '/api/updates/plugin%3Aeditorial/apply' }, impact: ['download'] } }),
  record({ id: 'gateway:openclaw', subject: { kind: 'gateway', id: 'openclaw', label: 'OpenClaw gateway' }, group: 'required',
    installed: { display: 'protocol 3' }, available: { display: 'protocol 4' }, reason: 'below-floor',
    action: { kind: 'manual', pointer: 'Upgrade the OpenClaw runtime so its gateway speaks protocol 4 or newer, then restart it.' } }),
  record({ id: 'hub-skill:hub-weather', subject: { kind: 'hub-skill', id: 'hub-weather', label: 'hub-weather' }, outcome: 'unknown', observedAt: undefined,
    attempt: { at: FAILED_AT, error: 'clawhub.example: 503 Service Unavailable' } }),
  record({ id: 'plugin:terminal', subject: { kind: 'plugin', id: 'terminal', label: 'terminal' },
    installed: { version: '0.2.0', display: '0.2.0' }, available: { version: '0.2.1', display: '0.2.1' }, reason: 'newer-version', skipped: { version: '0.2.1' },
    action: { kind: 'operation', start: { route: '/api/updates/plugin%3Aterminal/apply' }, impact: ['download'] } }),
  record({ id: 'plugin:assets', subject: { kind: 'plugin', id: 'assets', label: 'assets' }, outcome: 'current', installed: { version: '1.2.0', display: '1.2.0' } }),
]

const updates = { data: { records, generatedAt: CHECKED_AT, running: false } satisfies UpdatesData, error: null, backgroundError: null, loading: false, refreshing: false, refresh: async () => null }
const actions: UseUpdatesActionsResult = {
  feedback: { tone: 'success', message: 'terminal 0.2.1 stays hidden until something newer appears.' },
  dismissFeedback: () => {},
  checking: false,
  check: async () => {},
  skip: async () => {},
  apply: { state: { status: 'idle' }, operation: null, phase: 'loading', verification: { status: 'idle' }, open: async () => {}, confirm: async () => {}, close: () => {} },
}

function UpdatesFixture() {
  return <Page><PageHeader title="Health" description="Updates" /><PageBody>
    <UpdatesTabView updates={updates} actions={actions} showSkipped={false} onShowSkippedChange={() => {}} now={NOW} />
  </PageBody></Page>
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/health?tab=updates' }}
  registrations={[{ id: 'health', routes: { '/health': UpdatesFixture } }]}
/> )
