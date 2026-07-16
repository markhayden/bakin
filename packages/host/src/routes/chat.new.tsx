/**
 * /chat/new — draft conversation route (routing overhaul PR2).
 *
 * The draft agent rides `?agent=<agentId>` (read by the plugin), matching
 * the /workflows/new creation-surface precedent. Static path — TanStack
 * ranks it above /chat/$chatId (pinned by tests/host/chat-route-ranking).
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ChatNewPage() {
  return (
    <Suspense fallback={null}>
      <Slot name="page:/chat/new" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/chat/new',
  component: ChatNewPage,
})
