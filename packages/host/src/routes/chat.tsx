/**
 * /chat — direct agent conversations route.
 *
 * Thin Suspense wrapper around the chat plugin's slot.
 */
import { createRoute } from '@tanstack/react-router'
import { Slot } from '@makinbakin/sdk/slots'
import { Suspense } from 'react'
import { Route as RootRoute } from './__root'

function ChatPage() {
  return (
    <Suspense>
      <Slot name="page:/chat" />
    </Suspense>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/chat',
  component: ChatPage,
})
