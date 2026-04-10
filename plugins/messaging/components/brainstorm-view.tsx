'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
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
  const [showAgentPicker, setShowAgentPicker] = useState(false)
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
      setShowAgentPicker(false)
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
          <div className="relative">
            <Button
              size="sm"
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              disabled={creating}
            >
              <Plus className="size-3.5" data-icon="inline-start" />
              New Session
            </Button>

            {showAgentPicker && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
                {CONTENT_AGENTS.map(agentId => {
                  const info = AGENT_INFO[agentId]
                  return (
                    <button
                      key={agentId}
                      onClick={() => handleCreateSession(agentId)}
                      disabled={creating}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
                      data-testid={`agent-option-${agentId}`}
                    >
                      <AgentAvatar agentId={agentId} size="xs" />
                      <span>{info.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
