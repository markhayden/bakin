/**
 * Header operations tray (#895 D14): an indicator shown only while something
 * is running or has just finished. It opens a Popover of compact
 * OperationProgress rows with Cancel (while allowed) and a link to the
 * operation's own page. Operations started anywhere — this browser, the CLI,
 * Discord, the system — show here.
 */
import { ListChecks } from 'lucide-react'
import { toast } from '@makinbakin/sdk/hooks'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { OperationProgress } from '@makinbakin/sdk/patterns'
import {
  Badge,
  Button,
  buttonVariants,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@makinbakin/sdk/ui'
import { isOperationFinished, type OperationCancelResponse, type OperationView } from '@makinbakin/sdk/types'

import { useOperationsList } from './operations-list'

const CANCEL_REFUSED: Record<string, string> = {
  not_cancellable: 'It is past the point where it can be cancelled.',
  already_finished: 'It already finished.',
  not_found: 'It is no longer running.',
}

export async function cancelOperation(op: Pick<OperationView, 'id' | 'title'>): Promise<void> {
  try {
    const res = await fetch(`/api/operations/${encodeURIComponent(op.id)}/cancel`, { method: 'POST' })
    const body = (await res.json().catch(() => null)) as Partial<OperationCancelResponse> | null
    if (res.status === 202) return
    toast(`Couldn't cancel ${op.title}. ${CANCEL_REFUSED[body?.status ?? ''] ?? 'Try again.'}`, 'error')
  } catch {
    toast(`Couldn't reach Bakin to cancel ${op.title}.`, 'error')
  }
}

export function trayLabel(operations: readonly OperationView[]): string {
  const running = operations.filter((op) => !isOperationFinished(op.status)).length
  if (running > 0) return `Operations: ${running} running`
  return `Operations: ${operations.length} just finished`
}

export function OperationsTrayView({ operations }: { operations: readonly OperationView[] }) {
  if (operations.length === 0) return null
  const running = operations.filter((op) => !isOperationFinished(op.status)).length
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={trayLabel(operations)}
            data-testid="operations-tray-button"
            className="gap-bakin-2 border-bakin-border-subtle/60 text-bakin-text-muted hover:text-bakin-text-primary"
          />
        )}
      >
        <ListChecks aria-hidden="true" className="size-bakin-4" />
        <Badge tone={running > 0 ? 'accent' : 'neutral'} size="xs" aria-hidden="true">{running > 0 ? running : operations.length}</Badge>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-var(--bakin-layout-space-8)))]">
        <PopoverHeader>
          <PopoverTitle>Operations</PopoverTitle>
          <PopoverDescription>
            {running > 0 ? `${running} running` : 'Nothing running'} · finished work stays here for two minutes.
          </PopoverDescription>
        </PopoverHeader>
        <ul aria-label="Operations" className="m-0 flex list-none flex-col gap-bakin-4 p-0">
          {operations.map((op) => (
            <li key={op.id} className="flex min-w-0 flex-col gap-bakin-1">
              <OperationProgress
                operation={op}
                variant="compact"
                onCancel={op.cancellable ? () => { void cancelOperation(op) } : undefined}
              />
              {op.href ? (
                <PluginLink to={op.href} className={buttonVariants({ variant: 'link', size: 'inline', className: 'self-start' })}>
                  Open {op.title}
                </PluginLink>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function OperationsTray() {
  const operations = useOperationsList()
  return <OperationsTrayView operations={operations} />
}
