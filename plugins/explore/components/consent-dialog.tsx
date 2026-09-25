import { ShieldAlert } from 'lucide-react'
import { KeyValue } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@makinbakin/sdk/ui'

/**
 * Renders the awaitingConsent response from POST /api/plugins/install.
 * Accept re-POSTs with { accepted: true, consentToken }; Decline installs
 * nothing. When the server bounces with manifestChanged, the parent
 * re-renders this dialog with the fresh permission list + token and
 * `manifestChanged` set — never silently reusing the old token.
 */

// Cosmetic descriptions for the consent list. Unknown permissions render
// their raw id — honest, never hidden.
const PERMISSION_HINTS: Record<string, string> = {
  'events.emit': 'Broadcast Server-Sent Events to connected browsers',
  'assets.read': 'Read asset metadata and asset references',
  'assets.write': 'Save files into the asset store',
  'runtime.read': 'Read general runtime adapter state',
  'runtime.agents': 'Read runtime agent identity and status',
  'runtime.messaging': 'Send messages through the runtime adapter',
  'runtime.channels': 'Send messages to configured runtime channels',
  'runtime.cron': 'Create and manage runtime cron jobs',
  'runtime.skills': 'Read runtime skills',
  'runtime.models': 'Read runtime model metadata',
  'runtime.images': 'Generate images through the runtime adapter',
  'search.read': 'Query Bakin search indexes',
  'storage.read': 'Read Bakin content files',
  'storage.write': 'Write Bakin content files',
}

/** A binary the plugin will download into ~/.bakin/bin (spec plugin-managed-binaries §2.5). */
export interface ConsentBinRow {
  name: string
  version: string
  sha256: string
  sizeBytes?: number
}

export interface ConsentRequest {
  id: string
  version: string
  permissions: string[]
  /** Declared binary downloads for this platform; consent-worthy even when `permissions` is empty. */
  bins?: ConsentBinRow[]
  consentToken: string
  manifestChanged?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function downloadSummary(bin: ConsentBinRow): string {
  const parts = [] as string[]
  if (bin.sizeBytes !== undefined) parts.push(formatBytes(bin.sizeBytes))
  parts.push(bin.sha256 ? `sha256 ${bin.sha256.slice(0, 12)}…` : 'no build for this platform')
  parts.push('into ~/.bakin/bin')
  return parts.join(' · ')
}

export function ConsentDialog({
  consent,
  busy,
  onAccept,
  onDecline,
}: {
  consent: ConsentRequest | null
  busy: boolean
  onAccept: (consent: ConsentRequest) => void
  onDecline: () => void
}) {
  if (!consent) return null
  const bins = consent.bins ?? []
  const hasBins = bins.length > 0
  return (
    <Dialog busy={busy} open={consent !== null} onOpenChange={(open) => { if (!open) onDecline() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {consent.id} v{consent.version} {hasBins && consent.permissions.length === 0 ? 'wants to download:' : 'wants permission to:'}
          </DialogTitle>
          <DialogDescription>
            {hasBins
              ? 'Installing this plugin grants it the capabilities below and downloads the listed binaries, sha256-verified, into ~/.bakin/bin. Decline to install nothing.'
              : 'Installing this plugin grants it the capabilities below. Decline to install nothing.'}
          </DialogDescription>
        </DialogHeader>

        {consent.manifestChanged ? (
          <Alert tone="attention" data-testid="manifest-changed-notice">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>{hasBins ? 'Permissions or downloads changed' : 'Permissions changed'}</AlertTitle>
            <AlertDescription>
              The plugin changed its {hasBins ? 'permission or download request' : 'permission request'} since the preview. Review the updated list before accepting.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Permission id → what it grants. Unknown ids keep their raw id and
            render an em dash for the description — honest, never hidden. */}
        {consent.permissions.length > 0 || !hasBins ? (
          <KeyValue
            layout="columns"
            data-testid="consent-permission-list"
            items={consent.permissions.map((permission) => ({
              label: <code className="font-bakin-typography-family-mono">{permission}</code>,
              value: PERMISSION_HINTS[permission] ?? null,
            }))}
          />
        ) : null}

        {/* Binary downloads — name + version, then size · pinned sha · target dir.
            Same KeyValue composition as the permission list; nothing is hidden. */}
        {hasBins ? (
          <KeyValue
            layout="columns"
            data-testid="consent-download-list"
            items={bins.map((bin) => ({
              label: <code className="font-bakin-typography-family-mono">{bin.name} {bin.version}</code>,
              value: downloadSummary(bin),
            }))}
          />
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
          <Button type="button" onClick={() => onAccept(consent)} disabled={busy} data-testid="consent-accept">
            {busy ? <Spinner /> : null}
            {busy ? 'Installing…' : 'Accept and install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
