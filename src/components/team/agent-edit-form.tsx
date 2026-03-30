'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/color-picker'
import { AgentAvatar } from '@/components/agent-avatar'
import { useAgentSettingsStore, useAgentColor } from '@/hooks/use-agent-settings'
import { AGENT_MAP } from '@/lib/agents-data'

interface AgentEditFormProps {
  agentId: string
  onDone: () => void
}

export function AgentEditForm({ agentId, onDone }: AgentEditFormProps) {
  const agent = AGENT_MAP[agentId]
  const settings = useAgentSettingsStore((s) => s.settings[agentId])
  const update = useAgentSettingsStore((s) => s.update)
  const currentColor = useAgentColor(agentId)

  const [displayName, setDisplayName] = useState(settings?.displayName ?? '')
  const [accentColor, setAccentColor] = useState(currentColor)
  const [saving, setSaving] = useState(false)

  if (!agent) return null

  const handleSave = async () => {
    setSaving(true)
    await update(agentId, {
      displayName: displayName || undefined,
      accentColor,
    })
    setSaving(false)
    onDone()
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-4">
        <AgentAvatar agentId={agentId} size="xl" />
        <div>
          <div className="text-lg font-medium">{displayName || agent.name}</div>
          <div className="text-sm text-muted-foreground">{agent.role}</div>
        </div>
      </div>

      {/* Display Name */}
      <div className="space-y-2">
        <Label htmlFor="displayName">Display Name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={agent.name}
        />
        <p className="text-xs text-muted-foreground">Leave empty to use the default name.</p>
      </div>

      {/* Accent Color */}
      <div className="space-y-2">
        <Label>Accent Color</Label>
        <ColorPicker value={accentColor} onChange={setAccentColor} />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
