/**
 * Chat page — placeholder shell (C1). The chat list, view, and composer
 * land in C4.
 */
import { Suspense } from 'react'
import { PluginHeader } from '@makinbakin/sdk/components'

export function ChatPage() {
  return (
    <Suspense fallback={null}>
      <div className="flex h-full flex-col">
        <PluginHeader title="Chat" />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Chat with your agents — coming online in this build.
        </div>
      </div>
    </Suspense>
  )
}
