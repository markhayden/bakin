import { Loader2, ShieldAlert } from 'lucide-react'
import {
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
    <Dialog open={consent !== null} onOpenChange={(open) => { if (!open) onDecline() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {consent.id} v{consent.version} wants permission to:
          </DialogTitle>
          <DialogDescription>
            Installing this plugin grants it the capabilities below. Decline to install nothing.
          </DialogDescription>
        </DialogHeader>

        {consent.manifestChanged && (
          <div
            data-testid="manifest-changed-notice"
            className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            The plugin's permissions changed since the preview. Review the updated list before accepting.
          </div>
        )}

        <ul className="flex flex-col gap-2" data-testid="consent-permission-list">
          {consent.permissions.map((permission) => (
            <li key={permission} className="flex flex-col rounded-md border border-border px-3 py-2">
              <code className="text-sm text-foreground">{permission}</code>
              {PERMISSION_HINTS[permission] && (
                <span className="text-xs text-muted-foreground">{PERMISSION_HINTS[permission]}</span>
              )}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
          <Button type="button" onClick={() => onAccept(consent)} disabled={busy} data-testid="consent-accept">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
