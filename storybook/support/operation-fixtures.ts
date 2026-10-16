import type { OperationProgressProps } from '@makinbakin/sdk/patterns'

type OperationView = OperationProgressProps['operation']
type OperationStageView = OperationView['stages'][number]
type OperationStageStatus = OperationStageView['status']

/** The fixed clock every OperationProgress story renders against. */
export const OPERATION_NOW = Date.parse('2026-10-16T12:00:00.000Z')

/** An ISO timestamp `seconds` before the story clock. */
export function opAgo(seconds: number): string {
  return new Date(OPERATION_NOW - seconds * 1000).toISOString()
}

const INSTALL_STAGES: Array<Pick<OperationStageView, 'id' | 'kind' | 'label'>> = [
  { id: 'resolve', kind: 'preparing', label: 'Resolve package' },
  { id: 'download', kind: 'downloading', label: 'Download archive' },
  { id: 'extract', kind: 'extracting', label: 'Unpack into staging' },
  { id: 'install', kind: 'installing', label: 'Install requirements' },
  { id: 'verify', kind: 'verifying', label: 'Verify' },
]

/** The install plan with each stage set to the given status (pending past the list). */
export function installStages(statuses: OperationStageStatus[], extra: Partial<Record<string, Partial<OperationStageView>>> = {}): OperationStageView[] {
  return INSTALL_STAGES.map((stage, i) => {
    const status = statuses[i] ?? 'pending'
    const timed = status === 'pending' ? {} : { startedAt: opAgo(60 - i * 10), ...(status === 'active' ? {} : { endedAt: opAgo(50 - i * 10) }) }
    return { ...stage, status, ...timed, ...extra[stage.id] }
  })
}

/** A running install of the Copywriter agent package; override anything. */
export function operationFixture(over: Partial<OperationView> = {}): OperationView {
  return {
    id: 'op-install-copywriter',
    children: [],
    rev: 12,
    bootId: 'boot-story',
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install Copywriter agent',
    fingerprint: 'install:copywriter',
    resources: ['install-state'],
    status: 'running',
    plan: { stages: INSTALL_STAGES, pointOfNoReturn: 'install' },
    stages: installStages(['done', 'active']),
    cancellable: true,
    startedAt: opAgo(60),
    lastProgressAt: opAgo(1),
    lastLivenessAt: opAgo(1),
    log: [
      { at: opAgo(60), level: 'info', stageId: 'resolve', text: 'Resolved github:makinbakin/copywriter@v1.4.0' },
      { at: opAgo(50), level: 'info', stageId: 'download', text: 'Downloading copywriter-1.4.0.tar.gz' },
    ],
    ...over,
  }
}
