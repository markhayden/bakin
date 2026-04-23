'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from '@bakin/sdk/hooks'
import { Button } from "@bakin/sdk/ui"
import { Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@bakin/sdk/ui"
import { PluginHeader } from "@bakin/sdk/components"
import { AgentAvatar } from "@bakin/sdk/components"
import { AgentFilter } from "@bakin/sdk/components"
import { useQueryState } from "@bakin/sdk/hooks"
import { useSearch } from "@bakin/sdk/hooks"
import { useAgentList, useAgentIds } from "@bakin/sdk/hooks"
import { SessionList } from './session-list'
import { PlanningLayout } from './planning-layout'
import { NewSessionDialog } from './new-session-dialog'

export function BrainstormView() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const sessionId = searchParams.get('session') ?? ''
  const [search, setSearch] = useQueryState('q', '')
  const [agentFilter, setAgentFilter] = useQueryState('agent', 'all')
  const [creating, setCreating] = useState(false)
  const [sessionCount, setSessionCount] = useState<number | undefined>(undefined)
  const [pendingAgent, setPendingAgent] = useState<string | null>(null)
  const agentList = useAgentList()
  const agentIds = useAgentIds()

  const searchHook = useSearch({ plugin: 'messaging', facets: ['status', 'agent_id'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // searchHook is a fresh object each render; including it in deps would
    // re-fire every tick. Only the query string change should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const pushSessionId = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set('session', id)
    } else {
      params.delete('session')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, router, pathname])

  // Open the naming dialog for a given agent
  const handleStartCreate = (agentId: string) => {
    setPendingAgent(agentId)
  }

  // Actually create the session with a name
  const handleCreateSession = async (agentId: string, title: string) => {
    setPendingAgent(null)
    setCreating(true)
    try {
      const res = await fetch('/api/plugins/messaging/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, title }),
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
              {agentList.map(agent => (
                <DropdownMenuItem
                  key={agent.id}
                  onClick={() => handleStartCreate(agent.id)}
                  data-testid={`agent-option-${agent.id}`}
                >
                  <AgentAvatar agentId={agent.id} size="xs" />
                  <span>{agent.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mt-4 flex flex-col gap-4">
        <AgentFilter
          agentIds={agentIds}
          value={agentFilter}
          onChange={setAgentFilter}
        />
        <SessionList
          onSelectSession={pushSessionId}
          search={search}
          searchResults={searchHook.results}
          searchLoading={searchHook.loading}
          agentFilter={agentFilter}
          onCountChange={setSessionCount}
          onCreateSession={handleStartCreate}
          creating={creating}
        />
      </div>

      <NewSessionDialog
        open={!!pendingAgent}
        agentId={pendingAgent}
        onConfirm={handleCreateSession}
        onCancel={() => setPendingAgent(null)}
      />
    </div>
  )
}
