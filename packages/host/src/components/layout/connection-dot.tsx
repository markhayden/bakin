import { useContentStore } from '@makinbakin/sdk/hooks'

export function ConnectionDot() {
  const connected = useContentStore((s) => s.connected)

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <div
        className={`size-2 rounded-full ${
          connected
            ? 'bg-success animate-pulse-dot'
            : 'bg-destructive'
        }`}
      />
      <span className="text-muted-foreground">
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
  )
}
