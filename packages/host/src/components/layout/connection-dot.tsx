import { useContentStore } from '@makinbakin/sdk/hooks'
import { cn } from '@makinbakin/sdk/utils'

export function ConnectionDot() {
  const connected = useContentStore((s) => s.connected)

  return (
    <div
      role="status"
      aria-label={connected ? 'Live connection' : 'Offline'}
      className="flex shrink-0 items-center gap-2 text-xs font-mono"
    >
      <div
        aria-hidden="true"
        className={cn('size-2 rounded-full', connected
            ? 'bg-bakin-action-primary-background animate-pulse-dot'
            : 'bg-bakin-signal-danger')}
      />
      <span className="sr-only text-bakin-text-muted sm:not-sr-only">
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
  )
}
