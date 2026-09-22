'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { Banner, Button, buttonVariants, DrawerSection, SystemState, Text } from '@makinbakin/sdk/ui'
import { ListRow, ListRowActions, ListRows } from '@makinbakin/sdk/patterns'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { FolderOpen, Plus, X } from 'lucide-react'
import { AssetThumb } from './versioned/atoms'
import { VERSIONED_API } from './versioned/asset-urls'
import type { VersionedAssetSummary } from './versioned/types'

interface TaskAssetsProps {
  taskId: string
  readOnly?: boolean
}

export function TaskAssets({ taskId, readOnly }: TaskAssetsProps) {
  const [assets, setAssets] = useState<VersionedAssetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const requestId = useRef(0)
  const mutation = useRef(false)
  const currentTask = useRef(taskId)
  currentTask.current = taskId

  const fetchAssets = useCallback(async () => {
    const request = ++requestId.current
    try {
      const response = await fetch(`${VERSIONED_API}?taskId=${encodeURIComponent(taskId)}&includeChildren=true`, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Could not load task assets (HTTP ${response.status})`)
      const data = await response.json()
      if (request === requestId.current) { setAssets(data.assets ?? []); setError(null) }
    } catch (err) {
      if (request === requestId.current) setError(err instanceof Error ? err.message : 'Could not load task assets')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    setAssets([]); setLoading(true); setError(null); setUnlinkError(null)
    void fetchAssets()
    return () => { requestId.current++ }
  }, [fetchAssets])

  // Auto-refresh on asset + workflow events for this task (over the shell's
  // single SSE connection).
  usePluginEvent('asset.changed', fetchAssets)
  usePluginEvent('asset.removed', fetchAssets)
  usePluginEvent('workflow.step_complete', (d) => {
    const t = d.taskId as string | undefined
    if (t === taskId || t?.startsWith(taskId + '--')) fetchAssets()
  })

  // Local upload events (e.g. clipboard paste in the same dialog).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.taskId === taskId) fetchAssets()
    }
    window.addEventListener('bakin:asset-uploaded', handler)
    return () => window.removeEventListener('bakin:asset-uploaded', handler)
  }, [taskId, fetchAssets])

  const handleUnlink = async (assetId: string) => {
    if (mutation.current || readOnly) return
    mutation.current = true
    setUnlinking(assetId); setUnlinkError(null)
    try {
      const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/relink`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: null }), signal: AbortSignal.timeout(15_000),
      })
      if (currentTask.current !== taskId) return
      if (!res.ok) throw new Error(`Could not remove asset from task (HTTP ${res.status})`)
      await fetchAssets()
    } catch (err) {
      if (currentTask.current === taskId) setUnlinkError(err instanceof Error ? err.message : 'Could not remove asset from task')
    } finally {
      mutation.current = false
      setUnlinking(null)
    }
  }

  if (loading) return <SystemState kind="loading" scope="inline" title="Loading task assets" />

  return (
    <DrawerSection
      title={(
        <span className="inline-flex items-center gap-bakin-1">
          <FolderOpen className="size-bakin-3" aria-hidden="true" />
          Assets {assets.length > 0 && `(${assets.length})`}
        </span>
      )}
      actions={!readOnly ? (
          <PluginLink
            to={`/assets?linkTo=${encodeURIComponent(taskId)}`}
            className={`ml-auto ${buttonVariants({ size: 'xs' })}`}
          >
            <Plus className="size-bakin-3" />
            Add
          </PluginLink>
      ) : undefined}
    >
      {error && <Banner tone="danger" title="Task assets could not be loaded" description={error} action={<Button variant="outline" size="xs" onClick={() => void fetchAssets()}>Retry</Button>} />}
      {unlinkError && <Banner tone="danger" title="Asset was not removed" description={unlinkError} />}
      {!error && assets.length === 0 && <Text size="meta" tone="muted">No assets attached.</Text>}
      <ListRows variant="separated" size="sm" aria-label="Task assets">
        {assets.map(asset => (
          <ListRow
            key={asset.assetId}
            className="flex min-w-0 items-center gap-bakin-2"
            interactive={{ label: `Open ${asset.description || asset.assetId}`, render: <PluginLink to={`/assets/${encodeURIComponent(asset.assetId)}`} /> }}
          >
              <span className="size-bakin-8 shrink-0 overflow-hidden rounded-bakin-control">
                <AssetThumb assetId={asset.assetId} type={asset.type} version={asset.currentVersion} hasThumb={asset.hasThumb} />
              </span>
              <span className="min-w-0 flex-1">
                <Text size="meta" weight="medium" className="block break-words">{asset.description || asset.assetId}</Text>
                {asset.versionCount > 1 && (
                  <span className="block text-bakin-typography-size-meta text-bakin-action-primary-background">v{asset.currentVersion} · {asset.versionCount} versions</span>
                )}
              </span>
            {!readOnly && (
              <ListRowActions>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => handleUnlink(asset.assetId)}
                className="shrink-0 text-bakin-text-muted"
                disabled={unlinking !== null}
                aria-label={`Remove ${asset.description || asset.assetId} from task`}
              >
                <X className="size-bakin-3" />
              </Button>
              </ListRowActions>
            )}
          </ListRow>
        ))}
      </ListRows>
    </DrawerSection>
  )
}
