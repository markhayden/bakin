'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { BakinDrawer } from '@/components/bakin-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/agent-avatar'
import { AgentEditForm } from '@/components/team/agent-edit-form'
import { AGENT_MAP } from '@/lib/agents-data'
import { formatAge, isStale } from '@/lib/format'
import type { Heartbeat } from '@/types'

interface AgentDrawerProps {
  agentId: string | null
  heartbeat?: Heartbeat
  open: boolean
  onClose: () => void
}

export function AgentDrawer({ agentId, heartbeat, open, onClose }: AgentDrawerProps) {
  const [editing, setEditing] = useState(false)
  const profile = agentId ? AGENT_MAP[agentId] : null
  if (!profile) return null

  const active = heartbeat && !isStale(heartbeat.timestamp)

  const handleClose = () => {
    setEditing(false)
    onClose()
  }

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) handleClose() }}
      title={
        <div className="flex items-center gap-4 mb-2">
          <AgentAvatar agentId={profile.id} size="xl" />
          <div className="flex-1">
            <div className="text-lg font-medium">{profile.name}</div>
            <div className="text-sm text-muted-foreground">{profile.role}</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={active ? 'default' : 'secondary'} className="text-xs">
                {active ? `active · ${formatAge(heartbeat!.timestamp)}` : 'standby'}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">{profile.model}</span>
            </div>
          </div>
          {!editing && (
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} className="shrink-0">
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      }
    >
      {editing ? (
        <AgentEditForm agentId={profile.id} onDone={() => setEditing(false)} />
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Who They Are</h3>
            <p className="text-sm text-foreground leading-relaxed">{profile.definition}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-success mb-2">Should Do</h3>
            <ul className="space-y-1.5">
              {profile.shouldDo.map((item, i) => (
                <li key={i} className="text-sm text-foreground flex gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-2">Should Not Do</h3>
            <ul className="space-y-1.5">
              {profile.shouldNotDo.map((item, i) => (
                <li key={i} className="text-sm text-foreground flex gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Examples</h3>
            <ul className="space-y-2">
              {profile.examples.map((item, i) => (
                <li key={i} className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2 leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tools & Access</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.tools.map((tool, i) => (
                <Badge key={i} variant="outline" className="text-xs font-normal">{tool}</Badge>
              ))}
            </div>
          </section>

          {heartbeat && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Live Status</h3>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-mono">{heartbeat.status}</span>
                </div>
                {heartbeat.currentTask && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current task</span>
                    <span className="max-w-[200px] text-right">{heartbeat.currentTask}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last heartbeat</span>
                  <span className="font-mono">{formatAge(heartbeat.timestamp)}</span>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </BakinDrawer>
  )
}
