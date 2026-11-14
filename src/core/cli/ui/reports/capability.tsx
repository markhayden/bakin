import { Box, Text } from 'ink'
import { DataTable, FindingRows, NextActions, ScreenHeader, Section, StatusTable, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { formatBytes } from '../../../../cli/output'
import { timestampText } from './format'
import { loginReasonText } from './login-reason'

/**
 * Capability-pack screens for `bakin packages install` (the consent shown
 * before anything is written, then the pack's readiness) and
 * `bakin packages login-check`. Readiness rows come from the ONE readiness
 * engine's answer; these screens only lay it out.
 */

/** What a pack declares, read from its manifest before consent. */
export interface PackInstallPreviewData {
  /** The source as the operator typed it, and the absolute path or ref Bakin reads. */
  source: string
  origin: string
  /** `read`: the manifest was read; `remote`: a remote source (listed after install); `unreadable`: the read failed. */
  manifest: 'read' | 'remote' | 'unreadable'
  problem?: string
  name?: string
  version?: string
  description?: string
  skills: string[]
  bins: Array<{ name: string; version: string; host: string }>
  npm: Array<{ name: string; dependencies: number }>
  models: Array<{ name: string; bytes: number }>
  prereqs: Array<{ name: string; optional: boolean }>
  logins: Array<{ name: string; probe: string; setup: string }>
}

interface InstallRow { what: string; name: string; detail: string }

function installRows(preview: PackInstallPreviewData): InstallRow[] {
  return [
    ...preview.skills.map(skill => ({ what: 'skill', name: skill, detail: 'projected to the active runtime' })),
    ...preview.bins.map(bin => ({ what: 'binary', name: `${bin.name} ${bin.version}`, detail: `downloaded from ${bin.host}, sha256-pinned into ~/.bakin/bin` })),
    ...preview.npm.map(npm => ({ what: 'npm', name: npm.name, detail: `${npm.dependencies} pinned ${npm.dependencies === 1 ? 'dependency' : 'dependencies'} into ~/.bakin/npm` })),
    ...preview.models.map(model => ({ what: 'model', name: model.name, detail: `${formatBytes(model.bytes)} download into ~/.bakin/models` })),
  ]
}

export function PackInstallConsentReport({ preview, color = true }: {
  preview: PackInstallPreviewData
  color?: boolean
}) {
  const rows = installRows(preview)
  const title = preview.name ? `Install ${preview.name}` : 'Install package'
  const notice: FindingRow[] = preview.manifest === 'remote'
    ? [{ status: 'skip', label: 'requirements', message: 'Bakin reads a remote pack\'s manifest once it has fetched it; its binaries and logins are listed after install.' }]
    : preview.manifest === 'unreadable'
      ? [{ status: 'warn', label: 'manifest', message: `Could not read the manifest: ${preview.problem ?? 'unknown error'}`, detail: 'The install reads it again and refuses a pack whose manifest is invalid.' }]
      : []

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title={title}
        meta={preview.version ? `v${preview.version}` : undefined}
        subtitle={`from ${preview.origin}`}
        color={color}
      />
      {preview.description ? <Box marginTop={1}><Text wrap="wrap">{preview.description}</Text></Box> : null}
      {notice.length > 0 ? <Section title="Before you install" color={color}><FindingRows rows={notice} color={color} /></Section> : null}
      {rows.length > 0 ? (
        <Section title="Installs" color={color}>
          <DataTable
            rows={rows}
            columns={[
              { key: 'what', header: 'WHAT', width: 8, render: row => row.what },
              { key: 'name', header: 'NAME', width: 26, render: row => row.name },
              { key: 'detail', header: 'DETAIL', width: 40, grow: true, render: row => row.detail },
            ]}
          />
        </Section>
      ) : null}
      {preview.prereqs.length > 0 ? (
        <Section title="Needs on this machine" color={color}>
          {preview.prereqs.map(prereq => (
            <Text key={prereq.name} wrap="wrap">- {prereq.name}{prereq.optional ? ' (optional)' : ''}: checked, never installed by Bakin</Text>
          ))}
          <Text> </Text>
        </Section>
      ) : null}
      {preview.logins.map(login => (
        <Section key={login.name} title={`Login: ${login.name}`} color={color}>
          <Text wrap="wrap">Checked by running <Text bold>{login.probe}</Text> after install, on sync and when you ask. The check only reads.</Text>
          <Text wrap="wrap">Log in with: <Text color={color ? 'cyan' : undefined}>{login.setup}</Text></Text>
          <Text> </Text>
        </Section>
      ))}
      <Text dimColor wrap="wrap">Skill scripts run as agent shell commands.</Text>
    </Box>
  )
}

/** The readiness engine's answer for one pack (a structural subset of `CapabilityReadiness`). */
export interface CapabilityStatusData {
  capability: string
  name: string
  ready: boolean
  missing: string[]
  skills: Array<{ name: string; status: string }>
  bins: Array<{ name: string; status: string }>
  npm: Array<{ name: string; status: string }>
  models: Array<{ name: string; status: string }>
  prereqs: Array<{ name: string; optional: boolean; status: string }>
  login: Array<{ name: string; status: string; reason?: string; checkedAt?: string; account?: string }>
  secrets: Array<{ name: string; required: boolean; status: string }>
}

interface LegRow { status: TuiStatus; leg: string; name: string; detail: string }

function loginDetail(login: CapabilityStatusData['login'][number]): string {
  const checked = login.checkedAt ? ` · checked ${timestampText(login.checkedAt)}` : ''
  if (login.status === 'ok') return `logged in${login.account ? ` as ${login.account}` : ''}${checked}`
  if (login.status === 'missing') return `needs login: ${loginReasonText(login.reason)}${checked}`
  return `${loginReasonText(login.reason)}${checked}`
}

function legRows(cap: CapabilityStatusData): LegRow[] {
  const present = (status: string): TuiStatus => (status === 'ok' ? 'ok' : 'fail')
  return [
    ...cap.skills.map(s => ({ status: present(s.status), leg: 'skill', name: s.name, detail: s.status === 'ok' ? 'projected' : 'not projected' })),
    ...cap.bins.map(b => ({ status: present(b.status), leg: 'binary', name: b.name, detail: b.status === 'ok' ? 'installed, matches its pin' : b.status })),
    ...cap.npm.map(n => ({ status: present(n.status), leg: 'npm', name: n.name, detail: n.status === 'ok' ? 'installed' : n.status })),
    ...cap.models.map(m => ({ status: present(m.status), leg: 'model', name: m.name, detail: m.status === 'ok' ? 'downloaded' : 'not downloaded' })),
    ...cap.prereqs.map(p => ({
      status: p.status === 'ok' ? 'ok' as const : p.optional ? 'skip' as const : 'todo' as const,
      leg: 'prereq',
      name: p.name,
      detail: p.status === 'ok' ? 'found' : p.optional ? 'not found (optional)' : 'not found',
    })),
    ...cap.login.map(l => ({ status: l.status === 'ok' ? 'ok' as const : l.status === 'missing' ? 'todo' as const : 'warn' as const, leg: 'login', name: l.name, detail: loginDetail(l) })),
    ...cap.secrets.map(s => ({
      status: s.status !== 'missing' ? 'ok' as const : s.required ? 'todo' as const : 'skip' as const,
      leg: 'key',
      name: s.name,
      detail: s.status === 'env' ? 'set in the environment' : s.status === 'store' ? 'stored in Bakin' : s.required ? 'not configured' : 'not configured (optional)',
    })),
  ]
}

export function CapabilityStatusReport({ cap, color = true, showBrand = false }: {
  cap: CapabilityStatusData
  color?: boolean
  showBrand?: boolean
}) {
  const rows = legRows(cap)
  return (
    <Box flexDirection="column" marginTop={1}>
      <ScreenHeader title={cap.name} meta={`capability: ${cap.capability}`} showBrand={showBrand} color={color} />
      <SummaryStrip items={[
        cap.ready
          ? { label: 'agents can use it now', value: 'Ready', status: 'ready' }
          : { label: `${cap.missing.length} step${cap.missing.length === 1 ? '' : 's'} left`, value: 'Not ready', status: 'todo' },
      ]} color={color} />
      <Section title="Readiness" color={color}>
        <StatusTable
          rows={rows}
          columns={[
            { key: 'leg', header: 'LEG', width: 8, render: row => row.leg },
            { key: 'name', header: 'NAME', width: 32, render: row => row.name },
            { key: 'detail', header: 'DETAIL', width: 40, grow: true, render: row => row.detail },
          ]}
          color={color}
        />
      </Section>
      {cap.ready ? null : <NextActions actions={cap.missing} color={color} />}
    </Box>
  )
}

export interface LoginCheckRowData {
  name: string
  setup: string
  status: string
  reason?: string
  account?: string
  checkedAt?: string
}

export function LoginCheckReport({ packageId, receipts, color = true }: {
  packageId: string
  receipts: LoginCheckRowData[]
  color?: boolean
}) {
  const rows = receipts.map(r => ({
    status: r.status === 'ok' ? 'ok' as const : r.status === 'missing' ? 'todo' as const : 'warn' as const,
    login: r.name,
    detail: loginDetail(r),
  }))
  const actions = receipts.flatMap(r => {
    if (r.status === 'missing') return [`Log in to ${r.name}: ${r.setup}`, `Then check again: bakin packages login-check ${packageId}`]
    if (r.status === 'unknown') return [`Check again once fixed: bakin packages login-check ${packageId}`]
    return []
  })
  const unique = [...new Set(actions)]
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Login check" meta={`package: ${packageId}`} showBrand={false} color={color} />
      <Section title="Logins" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'login', header: 'LOGIN', width: 28, render: row => row.login },
              { key: 'detail', header: 'RESULT', width: 48, grow: true, render: row => row.detail },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'login', message: 'This package declares no login.' }]} color={color} />
        )}
      </Section>
      {unique.length > 0 ? <NextActions actions={unique} color={color} /> : null}
    </Box>
  )
}
