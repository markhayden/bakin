import { useContentStore } from '@makinbakin/sdk/hooks'
import { StatusMarker } from '@makinbakin/sdk/patterns'
import { Text } from '@makinbakin/sdk/ui'

export function ConnectionDot() {
  const connected = useContentStore((s) => s.connected)

  return (
    <div
      role="status"
      aria-label={connected ? 'Live connection' : 'Offline'}
      className="flex shrink-0 items-center gap-2"
    >
      <StatusMarker
        tone={connected ? 'success' : 'danger'}
        className={connected ? 'animate-pulse-dot' : undefined}
      />
      <Text size="meta" tone="muted" mono className="sr-only sm:not-sr-only">
        {connected ? 'LIVE' : 'OFFLINE'}
      </Text>
    </div>
  )
}
