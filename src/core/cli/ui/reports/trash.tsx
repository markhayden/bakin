import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, bytesText, timestampText, daysUntilText, metadataAgent, plural } from './format'

export interface TrashAssetData {
  filename?: unknown
  originalFilename?: unknown
  type?: unknown
  size?: unknown
  deletedAt?: unknown
  expiresAt?: unknown
  metadata?: unknown
}

export interface TrashActionData {
  action?: unknown
  target?: unknown
  count?: unknown
  message?: unknown
  detail?: unknown
}

interface TrashAssetTableRow {
  status: TuiStatus
  filename: string
  type: string
  size: string
  deleted: string
  expires: string
  agent: string
}

function trashAssetTableRows(assets: TrashAssetData[]): TrashAssetTableRow[] {
  return assets.map(asset => ({
    status: 'warn',
    filename: valueText(asset.originalFilename, valueText(asset.filename)),
    type: valueText(asset.type),
    size: bytesText(asset.size),
    deleted: timestampText(asset.deletedAt),
    expires: daysUntilText(asset.expiresAt),
    agent: metadataAgent(asset.metadata),
  }))
}

function trashActionStatus(action: TrashActionData): TuiStatus {
  const name = valueText(action.action)
  if (name === 'empty') return 'skip'
  return name === 'restored' || name === 'emptied' ? 'applied' : 'ok'
}

function trashActionRows(action: TrashActionData) {
  const status = trashActionStatus(action)
  const actionName = valueText(action.action, 'updated')
  const label = valueText(action.target, actionName)
  const count = valueText(action.count, '')
  const fallback = actionName === 'emptied'
    ? `Permanently deleted ${count || '0'} item${count === '1' ? '' : 's'}.`
    : actionName === 'empty'
      ? 'Trash is already empty.'
      : `Updated ${label}.`
  const detail = valueText(action.detail, '')

  return [{
    status,
    label,
    message: valueText(action.message, fallback),
    detail: detail || undefined,
  }]
}

export function TrashListReport({ assets, color = true }: {
  assets: TrashAssetData[]
  color?: boolean
}) {
  const rows = trashAssetTableRows(assets)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Trash" subtitle="Soft-deleted assets" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'item'), value: rows.length, status: rows.length > 0 ? 'warn' : 'skip' },
      ]} color={color} />
      <Section title="Trashed assets" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'filename', header: 'FILENAME', width: 18, render: row => row.filename },
              { key: 'type', header: 'TYPE', width: 8, render: row => row.type },
              { key: 'size', header: 'SIZE', width: 7, render: row => row.size },
              { key: 'deleted', header: 'DELETED', width: 16, render: row => row.deleted },
              { key: 'expires', header: 'EXPIRES', width: 7, render: row => row.expires },
              { key: 'agent', header: 'AGENT', width: 8, render: row => row.agent },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'Trash is empty.' }]} color={color} />
        )}
      </Section>
      <Section title="Restore" color={color}>
        <FindingRows rows={[{
          status: 'ready',
          label: 'command',
          message: 'bakin trash restore <trashName>',
          detail: 'Use the full trash filename with the __deleted- suffix.',
        }]} color={color} />
      </Section>
    </Box>
  )
}

export function TrashActionReport({ action, color = true }: {
  action: TrashActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const count = valueText(action.count, '')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Trash action" subtitle="Soft-deleted assets updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: trashActionStatus(action) },
        { label: 'items', value: count || '-', status: count ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={trashActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}
