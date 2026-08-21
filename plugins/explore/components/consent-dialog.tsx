import { Loader2, ShieldAlert } from 'lucide-react'
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

export interface ConsentRequest {
  id: string
  version: string
  permissions: string[]
  consentToken: string
  manifestChanged?: boolean
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
  return (
    <Dialog busy={busy} open={consent !== null} onOpenChange={(open) => { if (!open) onDecline() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {consent.id} v{consent.version} wants permission to:
          </DialogTitle>
          <DialogDescription>
            Installing this plugin grants it the capabilities below. Decline to install nothing.
          </DialogDescription>
        </DialogHeader>

        {consent.manifestChanged ? (
          <Alert tone="attention" data-testid="manifest-changed-notice">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Permissions changed</AlertTitle>
            <AlertDescription>
              The plugin changed its permission request since the preview. Review the updated list before accepting.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Permission id → what it grants. Unknown ids keep their raw id and
            render an em dash for the description — honest, never hidden. */}
        <KeyValue
          layout="columns"
          data-testid="consent-permission-list"
          items={consent.permissions.map((permission) => ({
            label: <code className="font-bakin-typography-family-mono">{permission}</code>,
            value: PERMISSION_HINTS[permission] ?? null,
          }))}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
          <Button type="button" onClick={() => onAccept(consent)} disabled={busy} data-testid="consent-accept">
            {busy ? <Loader2 aria-hidden="true" className="size-bakin-4 animate-spin" /> : null}
            {busy ? 'Installing…' : 'Accept and install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
