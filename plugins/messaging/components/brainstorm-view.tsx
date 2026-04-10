'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { PluginHeader } from '@/components/plugin-header'
import { SessionList } from './session-list'
import { PlanningLayout } from './planning-layout'

export function BrainstormView() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const sessionId = searchParams.get('session') ?? ''

  const pushSessionId = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set('session', id)
    } else {
      params.delete('session')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, router, pathname])

  const setSessionId = useCallback((id: string) => {
    pushSessionId(id)
  }, [pushSessionId])

  return (
    <div>
      <PluginHeader
        title="Brainstorm"
        search={undefined}
      />

      {sessionId ? (
        <div className="h-[calc(100vh-180px)] mt-4">
          <PlanningLayout
            sessionId={sessionId}
            onBack={() => setSessionId('')}
          />
        </div>
      ) : (
        <div className="mt-4">
          <SessionList onSelectSession={pushSessionId} />
        </div>
      )}
    </div>
  )
}
