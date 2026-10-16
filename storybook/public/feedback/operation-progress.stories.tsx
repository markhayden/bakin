import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { OperationProgress, type OperationProgressProps } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'
import { installStages, OPERATION_NOW, operationFixture, opAgo } from '../../support/operation-fixtures'

const meta = {
  title: 'Components/Feedback/OperationProgress',
  component: OperationProgress,
  tags: ['public'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'OperationProgress is the one progress surface for long-running work (installs, repairs, syncs, onboarding, runtime switch, search reset and reindex). It renders the operation\'s declared plan as a Timeline; the active stage carries a Progress bar that is determinate only when the size is known, with the measured value in words. Quiet and stuck are judged from measurable progress alone — output is shown as liveness and never resets the clock — so a step that keeps printing but never advances still reads as stuck. Waiting on another operation is an overlay naming the holder, not a stage. Cancel appears only while it is allowed; past the point of no return the control is replaced by the reason. Every non-happy state (stuck, failed, partially applied, verification failed, cancelling, cancelled, expired, restarted, unreachable) is an Alert with a written title, never color alone. Child operations (a repair\'s actions) nest under the parent\'s first stage, since a parent\'s plan is its children followed by verification. The activity log sits under a collapsed Details disclosure with copy. Pair it with `useOperation` from `@makinbakin/sdk/hooks`; `compact` is the tray and row form.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color', 'system-states', 'busy', 'error', 'progress'],
  },
  args: {
    now: OPERATION_NOW,
  },
} satisfies Meta<typeof OperationProgress>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  args: {
    variant: 'full',
    onCancel: fn(),
    operation: {
      id: 'op-1',
      children: [],
      rev: 4,
      bootId: 'boot-1',
      kind: 'install',
      owner: 'core',
      origin: 'web',
      title: 'Install Copywriter agent',
      fingerprint: 'install:copywriter',
      resources: ['install-state'],
      status: 'running',
      plan: {
        stages: [
          { id: 'download', kind: 'downloading', label: 'Download archive' },
          { id: 'install', kind: 'installing', label: 'Install requirements' },
        ],
        pointOfNoReturn: 'install',
      },
      stages: [
        { id: 'download', kind: 'downloading', label: 'Download archive', status: 'active', startedAt: '2026-10-16T11:59:30.000Z', bytes: { received: 12_400_000, total: 40_000_000 } },
        { id: 'install', kind: 'installing', label: 'Install requirements', status: 'pending' },
      ],
      cancellable: true,
      startedAt: '2026-10-16T11:59:30.000Z',
      lastProgressAt: '2026-10-16T11:59:59.000Z',
      lastLivenessAt: '2026-10-16T11:59:59.000Z',
      log: [],
    },
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['full', 'compact'] },
    operation: { control: false },
    childOperations: { control: false },
    phase: { control: 'select', options: [undefined, 'live', 'expired', 'restarted', 'unreachable'] },
  },
  render: (args) => (
    <div style={{ maxWidth: '40rem' }}>
      <OperationProgress {...args} />
    </div>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByRole('region', { name: 'Install Copywriter agent' })).toBeVisible()
    await expect(canvas.getByText('12.4 MB of 40.0 MB')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '31')
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
} satisfies Story

export const Planned = {
  args: { operation: operationFixture({ stages: installStages([]), lastProgressAt: opAgo(0), startedAt: opAgo(0) }) },
  play: async ({ canvas }) => {
    const steps = canvas.getByRole('list', { name: 'Install Copywriter agent steps' })
    await expect(within(steps).getAllByText('Pending')).toHaveLength(5)
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
} satisfies Story

export const Downloading = {
  args: {
    onCancel: fn(),
    operation: operationFixture({ stages: installStages(['done', 'active'], { download: { bytes: { received: 18_200_000, total: 52_400_000 } } }) }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('18.2 MB of 52.4 MB')).toBeVisible()
    await expect(canvas.getByText('In progress')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
} satisfies Story

export const UnknownTotal = {
  args: { operation: operationFixture({ stages: installStages(['done', 'active'], { download: { bytes: { received: 7_300_000, total: null } } }) }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('7.3 MB · size unknown')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  },
} satisfies Story

export const Retrying = {
  args: {
    operation: operationFixture({
      stages: installStages(['done', 'active'], {
        download: { bytes: { received: 4_100_000, total: 52_400_000 }, attempt: { n: 2, of: 3, reason: 'stalled', detail: 'no bytes for 30s' } },
      }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Attempt 2 of 3 — retrying because the transfer stalled \(no bytes for 30s\)/)).toBeVisible()
  },
} satisfies Story

export const QuietButAlive = {
  args: {
    operation: operationFixture({
      stages: installStages(['done', 'done', 'done', 'active']),
      lastProgressAt: opAgo(45),
      lastLivenessAt: opAgo(2),
      lastOutput: 'npm http fetch GET 200 https://registry.npmjs.org/sharp 312ms',
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/No measurable progress for 45s — still working; last output 2s ago/)).toBeVisible()
    await expect(canvas.getByText('npm http fetch GET 200 https://registry.npmjs.org/sharp 312ms')).toBeVisible()
    await expect(canvas.queryByText(/^No progress for/)).toBeNull()
  },
} satisfies Story

export const Stuck = {
  args: {
    operation: operationFixture({
      stages: installStages(['done', 'done', 'done', 'active']),
      lastProgressAt: opAgo(190),
      lastLivenessAt: opAgo(1),
      lastOutput: 'still compiling native module…',
    }),
  },
  play: async ({ canvas }) => {
    const alert = canvas.getByText('No progress for 3m 10s').closest('[data-slot="alert"]')
    await expect(alert).not.toBeNull()
    await expect(alert!.textContent).toContain('Install requirements has not advanced')
  },
} satisfies Story

export const Waiting = {
  args: {
    onCancel: fn(),
    operation: operationFixture({
      stages: installStages([]),
      waitingFor: { holderTitle: 'Install Researcher agent', holderOperationId: 'op-other', since: opAgo(40) },
    }),
  },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText('Waiting', { selector: 'span' })).toBeVisible()
    await expect(canvas.getByText('Waiting for Install Researcher agent')).toBeVisible()
    await expect(canvas.getByText(/Waiting 40s/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
} satisfies Story

export const StaleHolder = {
  args: {
    operation: operationFixture({
      stages: installStages([]),
      waitingFor: { holderTitle: 'Install Researcher agent', since: opAgo(95), stale: true },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Install Researcher agent stopped responding')).toBeVisible()
  },
} satisfies Story

export const ConcurrentItems = {
  args: {
    operation: operationFixture({
      id: 'op-reindex',
      kind: 'reindex',
      title: 'Rebuild search index',
      resources: ['search-engine'],
      plan: { stages: [{ id: 'tables', kind: 'building', label: 'Rebuild tables' }, { id: 'flip', kind: 'committing', label: 'Switch queries over' }], pointOfNoReturn: 'start' },
      cancellable: false,
      stages: [
        {
          id: 'tables', kind: 'building', label: 'Rebuild tables', status: 'active', startedAt: opAgo(80),
          items: [
            { id: 'tasks', label: 'Tasks', status: 'done', message: '1,240 documents' },
            { id: 'assets', label: 'Assets', status: 'active', message: '880 of 2,310 documents' },
            { id: 'chat', label: 'Chat transcripts', status: 'active', message: '310 of 1,020 documents' },
            { id: 'memory', label: 'Memory', status: 'pending' },
          ],
        },
        { id: 'flip', kind: 'committing', label: 'Switch queries over', status: 'pending' },
      ],
    }),
  },
  play: async ({ canvas }) => {
    const items = canvas.getByRole('list', { name: 'Rebuild tables items' })
    await expect(within(items).getAllByText('In progress')).toHaveLength(2)
    await expect(canvas.getByText('1 of 4')).toBeVisible()
    await expect(canvas.getByText("Can't be cancelled")).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
  },
} satisfies Story

type OperationView = OperationProgressProps['operation']

const repairParent = (over: Partial<OperationView> = {}) => operationFixture({
  id: 'op-repair',
  kind: 'repair',
  title: 'Apply 2 Health repairs',
  resources: [],
  children: ['op-repair-media', 'op-repair-sync'],
  plan: { stages: [{ id: 'children', kind: 'installing', label: 'Apply repairs' }, { id: 'verify', kind: 'verifying', label: 'Re-check Health' }], pointOfNoReturn: null },
  stages: [
    { id: 'children', kind: 'installing', label: 'Apply repairs', status: 'active', startedAt: opAgo(70) },
    { id: 'verify', kind: 'verifying', label: 'Re-check Health', status: 'pending' },
  ],
  cancellable: false,
  ...over,
})

const mediaChild = (over: Partial<OperationView> = {}) => operationFixture({
  id: 'op-repair-media',
  parentId: 'op-repair',
  kind: 'repair:install-media',
  title: 'Install the media store',
  resources: ['media-store'],
  plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download sharp' }, { id: 'commit', kind: 'committing', label: 'Commit' }], pointOfNoReturn: 'commit' },
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download sharp', status: 'done', startedAt: opAgo(70), endedAt: opAgo(40) },
    { id: 'commit', kind: 'committing', label: 'Commit', status: 'done', startedAt: opAgo(40), endedAt: opAgo(35) },
  ],
  status: 'succeeded',
  endedAt: opAgo(35),
  ...over,
})

const syncChild = (over: Partial<OperationView> = {}) => operationFixture({
  id: 'op-repair-sync',
  parentId: 'op-repair',
  kind: 'repair:agent-sync',
  title: 'Sync Copywriter workspace',
  plan: { stages: [{ id: 'compose', kind: 'installing', label: 'Recompose managed blocks' }], pointOfNoReturn: 'compose' },
  stages: [{ id: 'compose', kind: 'installing', label: 'Recompose managed blocks', status: 'active', startedAt: opAgo(30), items: [{ id: 'soul', label: 'SOUL.md', status: 'done' }, { id: 'agents', label: 'AGENTS.md', status: 'active' }] }],
  ...over,
})

export const RepairWithChildren = {
  args: { operation: repairParent(), childOperations: [mediaChild(), syncChild()] },
  play: async ({ canvas }) => {
    const included = canvas.getByRole('list', { name: 'Apply 2 Health repairs included operations' })
    await expect(within(included).getByText('Install the media store')).toBeVisible()
    await expect(within(included).getByText('Done')).toBeVisible()
    await expect(within(included).getByText('Recompose managed blocks')).toBeVisible()
    await expect(canvas.getByText('Will finish — past the point of no return')).toBeVisible()
  },
} satisfies Story

export const PartiallyApplied = {
  args: {
    operation: repairParent({
      status: 'failed',
      endedAt: opAgo(0),
      stages: [
        { id: 'children', kind: 'installing', label: 'Apply repairs', status: 'failed', startedAt: opAgo(70), endedAt: opAgo(5) },
        { id: 'verify', kind: 'verifying', label: 'Re-check Health', status: 'skipped', skippedReason: 'a repair failed' },
      ],
      outcome: { code: 'partially_applied', partiallyApplied: true, message: '1 of 2 repairs applied. Sync Copywriter workspace failed.' },
    }),
    childOperations: [
      mediaChild(),
      syncChild({ status: 'failed', endedAt: opAgo(5), outcome: { code: 'unexpected', message: 'AGENTS.md is marked user-edited; reclaim it first.' }, stages: [{ id: 'compose', kind: 'installing', label: 'Recompose managed blocks', status: 'failed', startedAt: opAgo(30), endedAt: opAgo(5) }] }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Partially applied')).toBeVisible()
    await expect(canvas.getByText('1 of 2 repairs applied. Sync Copywriter workspace failed.')).toBeVisible()
    await expect(canvas.getByText('AGENTS.md is marked user-edited; reclaim it first.')).toBeVisible()
    await expect(canvas.getByText('a repair failed')).toBeVisible()
  },
} satisfies Story

export const VerificationFailed = {
  args: {
    operation: operationFixture({
      status: 'failed',
      endedAt: opAgo(0),
      cancellable: false,
      stages: installStages(['done', 'done', 'done', 'done', 'failed'], { verify: { message: 'sha256 mismatch for bin/ffmpeg' } }),
      outcome: { code: 'verification_failed', message: 'The installed files do not match the pinned checksums.' },
    }),
  },
  play: async ({ canvas }) => {
    const alert = canvas.getByRole('alert')
    await expect(within(alert).getByText('Verification failed')).toBeVisible()
    await expect(canvas.getByText('sha256 mismatch for bin/ffmpeg')).toBeVisible()
  },
} satisfies Story

export const Cancelling = {
  args: { operation: operationFixture({ status: 'cancelling', cancellable: false }) },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Cancelling' })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByText('Stopping after the current step settles.')).toBeVisible()
  },
} satisfies Story

export const PastPointOfNoReturn = {
  args: {
    onCancel: fn(),
    operation: operationFixture({ stages: installStages(['done', 'done', 'done', 'active']), cancellable: false }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Will finish — past the point of no return')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
  },
} satisfies Story

export const NotCancellable = {
  args: {
    operation: operationFixture({
      kind: 'search-reset',
      title: 'Reset search',
      resources: ['search-engine'],
      cancellable: false,
      plan: { stages: [{ id: 'stop', kind: 'preparing', label: 'Stop the engine' }, { id: 'wipe', kind: 'cleanup', label: 'Wipe data' }, { id: 'start', kind: 'installing', label: 'Start the engine' }], pointOfNoReturn: 'start' },
      stages: [
        { id: 'stop', kind: 'preparing', label: 'Stop the engine', status: 'done', startedAt: opAgo(20), endedAt: opAgo(15) },
        { id: 'wipe', kind: 'cleanup', label: 'Wipe data', status: 'active', startedAt: opAgo(15) },
        { id: 'start', kind: 'installing', label: 'Start the engine', status: 'pending' },
      ],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Can't be cancelled")).toBeVisible()
    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  },
} satisfies Story

export const Failed = {
  args: {
    operation: operationFixture({
      status: 'failed',
      endedAt: opAgo(0),
      stages: installStages(['done', 'failed'], { download: { message: 'Gave up after 3 attempts: the connection failed.' } }),
      outcome: { code: 'download_failed', message: 'Could not download copywriter-1.4.0.tar.gz.' },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    const alert = canvas.getByRole('alert')
    await expect(within(alert).getByText('Failed')).toBeVisible()
    await expect(within(alert).getByText('Could not download copywriter-1.4.0.tar.gz.')).toBeVisible()
    const details = canvas.getByRole('button', { name: 'Details' })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    details.focus()
    await userEvent.keyboard('{Enter}')
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByLabelText('Activity log')).toHaveTextContent('Resolved github:makinbakin/copywriter@v1.4.0')
    await expect(canvas.getByRole('button', { name: 'Copy activity log' })).toBeVisible()
  },
} satisfies Story

export const Cancelled = {
  args: {
    operation: operationFixture({
      status: 'cancelled',
      endedAt: opAgo(0),
      cancellable: false,
      stages: installStages(['done', 'skipped', 'skipped', 'skipped', 'skipped'], { download: { skippedReason: 'cancelled' } }),
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Stopped before anything was changed.')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
  },
} satisfies Story

export const Succeeded = {
  args: {
    operation: operationFixture({
      status: 'succeeded',
      endedAt: opAgo(0),
      cancellable: false,
      stages: installStages(['done', 'done', 'done', 'done', 'done']),
      outcome: { code: 'ok', message: 'Copywriter is installed and synced.' },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Copywriter is installed and synced.')).toBeVisible()
    await expect(canvas.queryByRole('alert')).toBeNull()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
} satisfies Story

export const Expired = {
  args: { phase: 'expired', onRecheck: fn(), operation: operationFixture() },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText('This record has expired')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Re-check' }))
    await expect(args.onRecheck).toHaveBeenCalledOnce()
  },
} satisfies Story

export const RestartedOutcomeUnknown = {
  args: {
    phase: 'restarted',
    onRecheck: fn(),
    operation: operationFixture({ stages: installStages(['done', 'done', 'done', 'active']), cancellable: false, lastProgressAt: opAgo(300) }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Bakin restarted while this was running')).toBeVisible()
    await expect(canvas.getByText(/The outcome is unknown/)).toBeVisible()
    // A restart explains the silence; it is never also reported as stuck.
    await expect(canvas.queryByText(/^No progress for/)).toBeNull()
  },
} satisfies Story

export const Unreachable = {
  args: { phase: 'unreachable', operation: operationFixture() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Can't reach Bakin")).toBeVisible()
    await expect(canvas.getByText('Showing the last update received. Retrying.')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toBeVisible()
  },
} satisfies Story

export const Compact = {
  args: { operation: operationFixture() },
  render: (args) => (
    <StoryStage
      eyebrow="Feedback / operations"
      title="Compact rows for trays and lists"
      description="Title, status in words, elapsed time, the current stage with its bar, and Cancel only while it is allowed."
    >
      <StorySection title="Running now">
        <div style={{ display: 'grid', gap: '1rem', maxWidth: '24rem' }}>
          <OperationProgress
            variant="compact"
            now={args.now}
            onCancel={fn()}
            operation={operationFixture({ stages: installStages(['done', 'active'], { download: { bytes: { received: 18_200_000, total: 52_400_000 } } }) })}
          />
          <OperationProgress
            variant="compact"
            now={args.now}
            operation={operationFixture({
              id: 'op-2',
              title: 'Install Researcher agent with the long-form research pack and its pinned binaries',
              stages: installStages([]),
              waitingFor: { holderTitle: 'Install Copywriter agent', since: opAgo(12) },
            })}
          />
          <OperationProgress
            variant="compact"
            now={args.now}
            operation={operationFixture({ id: 'op-3', title: 'Rebuild search index', status: 'succeeded', endedAt: opAgo(5), cancellable: false, outcome: { code: 'ok', message: '4 tables rebuilt.' } })}
          />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const rows = canvas.getAllByRole('region')
    await expect(rows).toHaveLength(3)
    await expect(within(rows[0]!).getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(within(rows[1]!).getByText('Waiting for Install Copywriter agent')).toBeVisible()
    await expect(within(rows[2]!).getByText('4 tables rebuilt.')).toBeVisible()
    await expect(within(rows[2]!).queryByRole('progressbar')).toBeNull()
  },
} satisfies Story
