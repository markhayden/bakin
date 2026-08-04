'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, Upload, X } from 'lucide-react'
import { useAvailableModels } from '@makinbakin/sdk/hooks'
import { AgentAvatar, ModelSelect } from '@makinbakin/sdk/patterns'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FileInput,
  Form,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'

export interface AgentFormData {
  id: string
  name: string
  emoji: string
  model: string
  soul: string
  role: string
  vibe: string
  primaryFunction: string
  tools: string
  teamId: string
}

export function AgentForm({
  onSubmit,
  onCancel,
  submitting = false,
}: {
  onSubmit: (data: AgentFormData, avatarFile: File | null) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idManual, setIdManual] = useState(false)
  const [emoji, setEmoji] = useState('')
  const [model, setModel] = useState('')
  const availableModels = useAvailableModels()
  const [soul, setSoul] = useState('')
  const [role, setRole] = useState('')
  const [vibe, setVibe] = useState('')
  const [primaryFunction, setPrimaryFunction] = useState('')
  const [tools, setTools] = useState('')
  const [teamId, setTeamId] = useState('')
  const [teams, setTeams] = useState<Array<{ id: string; label: string }>>([])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!availableModels.length) return
    const preferred = availableModels.find((candidate) => candidate.isDefault)
      ?? availableModels.find((candidate) => candidate.configured)
      ?? availableModels[0]
    if (preferred) setModel((current) => current || preferred.id)
  }, [availableModels])

  useEffect(() => {
    fetch('/api/plugins/team/teams')
      .then((response) => response.json())
      .then((data) => { if (Array.isArray(data)) setTeams(data) })
      .catch(() => {})
  }, [])

  const handleNameChange = (value: string) => {
    setName(value)
    if (!idManual) setId(value.toLowerCase().replace(/[^a-z0-9]/g, ''))
  }

  const handleIdChange = (value: string) => {
    setIdManual(true)
    setId(value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }

  const handleAvatarFiles = (files: File[]) => {
    const file = files[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const clearAvatar = () => {
    setAvatarFile(null)
    setAvatarPreview(null)
  }

  const valid = name.trim().length > 0 && id.trim().length > 0

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || submitting) return
    void onSubmit(
      { id, name, emoji, model, soul, role, vibe, primaryFunction, tools, teamId },
      avatarFile,
    )
  }

  return (
    <Form busy={submitting} onSubmit={submit} aria-label="Create agent">
      <Field name="avatar">
        <FieldLabel>Profile image</FieldLabel>
        <FieldDescription>JPG, PNG, or WebP. This portrait appears throughout Bakin.</FieldDescription>
        <div className="flex min-w-0 items-center gap-bakin-3">
          <AgentAvatar
            agent={{
              id: id || 'new-agent',
              name: name || 'New agent',
              imageSrc: avatarPreview,
              initials: emoji || undefined,
            }}
            size="lg"
            decorative
          />
          <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <FileInput
              label="Profile image"
              accept="image/jpeg,image/png,image/webp"
              onFiles={handleAvatarFiles}
            >
              <Upload aria-hidden="true" />
              {avatarPreview ? 'Replace image' : 'Choose image'}
            </FileInput>
            {avatarPreview ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearAvatar}>
                <X aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </Field>

      <FieldGroup>
        <Field name="name">
          <FieldLabel htmlFor="agent-name" requirement="required">Name</FieldLabel>
          <FieldDescription>The human-readable name shown across Bakin.</FieldDescription>
          <Input
            id="agent-name"
            required
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="Pixel"
            autoFocus
          />
        </Field>

        <Field name="id">
          <FieldLabel htmlFor="agent-id" requirement="required">ID</FieldLabel>
          <FieldDescription>Used in runtime configuration and workspace paths. Lowercase, no spaces.</FieldDescription>
          <Input
            id="agent-id"
            required
            value={id}
            onChange={(event) => handleIdChange(event.target.value)}
            placeholder="pixel"
            className="font-bakin-typography-family-mono"
          />
        </Field>

        <div className="grid min-w-0 gap-bakin-4 @md/form:grid-cols-2">
          <Field name="emoji">
            <FieldLabel htmlFor="agent-emoji">Fallback mark</FieldLabel>
            <FieldDescription>Shown when no image is set.</FieldDescription>
            <Input
              id="agent-emoji"
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
              placeholder="PX"
              maxLength={2}
            />
          </Field>

          <Field name="model">
            <FieldLabel htmlFor="agent-model">Model</FieldLabel>
            <FieldDescription>The default model used for this agent’s work.</FieldDescription>
            <ModelSelect
              id="agent-model"
              value={model}
              onValueChange={setModel}
              models={availableModels}
            />
          </Field>
        </div>

        <Field name="soul">
          <FieldLabel htmlFor="agent-soul">Identity and behavior</FieldLabel>
          <FieldDescription>Written to the selected runtime workspace as SOUL.md.</FieldDescription>
          <FieldControl
            render={(
              <Textarea
                id="agent-soul"
                value={soul}
                onChange={(event) => setSoul(event.target.value)}
                placeholder="Describe who this agent is, what they do, and how they behave."
                rows={6}
                className="resize-y font-bakin-typography-family-mono"
                spellCheck={false}
              />
            )}
          />
        </Field>
      </FieldGroup>

      <Collapsible>
        <CollapsibleTrigger>
          <span>Advanced details</span>
          <ChevronRight
            aria-hidden="true"
            className="transition-transform duration-[var(--bakin-motion-duration-feedback)] group-data-[panel-open]/collapsible:rotate-90 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-bakin-2">
          <FieldGroup>
            <Field name="role">
              <FieldLabel htmlFor="agent-role">Role</FieldLabel>
              <Input
                id="agent-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="Research agent"
              />
            </Field>

            <Field name="vibe">
              <FieldLabel htmlFor="agent-vibe">Vibe</FieldLabel>
              <Input
                id="agent-vibe"
                value={vibe}
                onChange={(event) => setVibe(event.target.value)}
                placeholder="Sharp, credible, practical, curious"
              />
            </Field>

            <Field name="primaryFunction">
              <FieldLabel htmlFor="agent-primary-function">Primary function</FieldLabel>
              <Input
                id="agent-primary-function"
                value={primaryFunction}
                onChange={(event) => setPrimaryFunction(event.target.value)}
                placeholder="Multi-source research and evidence gathering"
              />
            </Field>

            <Field name="tools">
              <FieldLabel htmlFor="agent-tools">Tool guidance</FieldLabel>
              <FieldDescription>Written to TOOLS.md in the agent workspace.</FieldDescription>
              <FieldControl
                render={(
                  <Textarea
                    id="agent-tools"
                    value={tools}
                    onChange={(event) => setTools(event.target.value)}
                    placeholder="How this agent should choose and use tools."
                    rows={4}
                    className="resize-y font-bakin-typography-family-mono"
                    spellCheck={false}
                  />
                )}
              />
            </Field>

            {teams.length > 0 ? (
              <Field name="team">
                <FieldLabel htmlFor="agent-team">Team</FieldLabel>
                <FieldDescription>Optional initial team assignment.</FieldDescription>
                <Select value={teamId} onValueChange={(value) => setTeamId(value ?? '')}>
                  <SelectTrigger id="agent-team" className="w-full">
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      <FormActions className="border-t-0 pt-0">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <SubmitButton size="sm" disabled={!valid} busyLabel="Creating agent…">
          Create agent
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
