'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { PluginHeader } from '@/components/plugin-header'
import { AgentAvatar } from '@/components/agent-avatar'
import { AGENT_INFO } from '../types'
import type { ContentAgent } from '../types'
import { SessionList } from './session-list'
import { PlanningLayout } from './planning-layout'

const CONTENT_AGENTS = Object.keys(AGENT_INFO) as ContentAgent[]

export function BrainstormView() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const sessionId = searchParams.get('session') ?? ''
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [sessionCount, setSessionCount] = useState<number | undefined>(undefined)

  const pushSessionId = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set('session', id)
    } else {
      params.delete('session')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, router, pathname])

  const handleCreateSession = async (agentId: string) => {
    setCreating(true)
    try {
      const res = await fetch('/api/plugins/messaging/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      if (res.ok) {
        const data = await res.json()
        pushSessionId(data.session.id)
      }
    } catch {
      // Silently fail
    } finally {
      setCreating(false)
    }
  }

  if (sessionId) {
    return (
      <div className="h-[calc(100vh-120px)]">
        <PlanningLayout
          sessionId={sessionId}
          onBack={() => pushSessionId('')}
        />
      </div>
    )
  }

  return (
    <div>
      <PluginHeader
        title="Brainstorm"
        count={sessionCount}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search sessions...',
        }}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={creating}
              render={
                <Button size="sm" disabled={creating}>
                  <Plus className="size-3.5" data-icon="inline-start" />
                  New Session
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {CONTENT_AGENTS.map(agentId => {
                const info = AGENT_INFO[agentId]
                return (
                  <DropdownMenuItem
                    key={agentId}
                    onClick={() => handleCreateSession(agentId)}
                    data-testid={`agent-option-${agentId}`}
                  >
                    <AgentAvatar agentId={agentId} size="xs" />
                    <span>{info.name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mt-4">
        <SessionList
          onSelectSession={pushSessionId}
          search={search}
          onCountChange={setSessionCount}
          onCreateSession={handleCreateSession}
          creating={creating}
        />
      </div>
    </div>
  )
}
