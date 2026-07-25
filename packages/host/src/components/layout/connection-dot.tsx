import { useContentStore } from '@makinbakin/sdk/hooks'

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
        className={`size-2 rounded-full ${
          connected
            ? 'bg-success animate-pulse-dot'
            : 'bg-destructive'
        }`}
      />
      <span className="sr-only text-muted-foreground sm:not-sr-only">
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
  )
}
