/**
 * /chat/$chatId — active conversation route (routing overhaul PR2).
 *
 * Mirrors team.$id: resolves the path param via `Route.useParams()` and
 * hands it to the chat plugin's `page:/chat/[chatId]` slot as `chatId`.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ChatDetailPage() {
  const { chatId } = Route.useParams()
  return (
    <Suspense fallback={null}>
      <Slot name="page:/chat/[chatId]" chatId={chatId} />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/chat/$chatId',
  component: ChatDetailPage,
})
