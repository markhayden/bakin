import { Loader2, ShieldAlert } from 'lucide-react'
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

        <ul className="m-0 divide-y divide-bakin-border-subtle p-0" data-testid="consent-permission-list">
          {consent.permissions.map((permission) => (
            <li key={permission} className="flex list-none flex-col gap-bakin-1 px-bakin-2 py-bakin-3 first:pt-0 last:pb-0">
              <code className="font-bakin-typography-family-mono text-bakin-typography-size-body text-bakin-text-primary">
                {permission}
              </code>
              {PERMISSION_HINTS[permission] && (
                <span className="text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
                  {PERMISSION_HINTS[permission]}
                </span>
              )}
            </li>
          ))}
        </ul>

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
