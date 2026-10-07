/**
 * Settings → Channels (channel-readiness spec §4.11, D1): the ONE home for
 * channel delivery. Every fact on this page is a projection of the ONE
 * readiness snapshot (GET /api/channels, pushed live as `channels.readiness`)
 * — the same snapshot the Discord health check, the post tool, onboarding,
 * and `bakin channels` read — so this page and Health can never disagree.
 *
 * Sections: status header (+ Banner with the inline recovery action), bridge
 * settings, bot token (shared SecretSlotField), servers & channels, routing
 * (alert / approvals channel + alias map, saved with REPLACE semantics
 * through PUT /api/channels/routing), and the Reconnect / Verify actions.
 * Verify never sends anything.
 *
 * Patterns: recipes/settings-dashboard-pages.stories.tsx — SettingsCategories
 * (section rhythm), feedback/banner.stories.tsx — TonesAndActions,
 * feedback/system-state.stories.tsx — StateMatrix / ScopeAndRecovery,
 * feedback/status-badge.stories.tsx — CanonicalUsage, lists/key-value
 * .stories.tsx — CanonicalUsage, lists/data-table.stories.tsx,
 * forms/form-composition.stories.tsx — SubmissionWorkflow.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useJsonFetch, usePluginEvent } from '@makinbakin/sdk/hooks'
import { Grid, Inline, Section, Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { CopyButton, DataTable, KeyValue, ListRow, ListRows, StatusBadge, type DataTableColumn, type StatusBadgeVariant, type StatusTone } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  Banner,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Form,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { IdListEditor } from './channels/id-list-editor'
import { SecretSlotField, type SecretSlotRow } from './secret-slot-field'

export const CHANNELS_TAB_ID = 'channels'

/** Stable options: a fresh object per render would make useJsonFetch refetch (and remount the page) on every state change. */
const FETCH_OPTIONS = { timeoutMs: 15_000 }

// ── wire types (mirror packages/core/src/delivery/readiness.ts exactly) ──

type ReadinessState =
  | 'native' | 'disabled' | 'missing_token' | 'missing_guild'
  | 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'failed'

interface ErrorSummary { kind: string; message: string; at: string }
interface RoutingTarget { setting: string; value: string | null; resolved: 'ok' | 'unset' | 'unknown_channel' | 'unverifiable'; channelId?: string }
interface ChannelItem { id: string; platform: string; label: string; capabilities: string[] }

export interface ChannelReadinessPayload {
  runtime: { adapter: string; deliveryMode: string }
  owner: 'runtime' | 'bridge' | 'none'
  enabled: boolean
  token: { present: boolean; source: 'env' | 'store' | null }
  guilds: Array<{ id: string; name?: string; joined: boolean | null; channelCount: number | null; error?: ErrorSummary }>
  connection: { state: ReadinessState; since: string; lastError: ErrorSummary | null; botUser?: { id: string; name: string }; attempt?: { generation: number; startedAt: string } }
  channels: { items: ChannelItem[]; source: 'bridge' | 'runtime' | 'none'; collectedAt: string | null; error?: ErrorSummary }
  routing: { alertChannel: RoutingTarget; approvalsChannel: RoutingTarget; approvalsEnabled: boolean; aliases: RoutingTarget[] }
  remediation: { summary: string; nextStep: string; href: string; action: string | null } | null
  generatedAt: string
}

interface DiscordSettings {
  enabled: boolean
  guildIds: string[]
  approvers: string[]
  inbound: { enabled: boolean; agentId: string; requireMention: boolean; allowFrom: string[] }
}

interface ProbeItem { key: string; status: 'pass' | 'fail' | 'skipped'; summary: string; detail?: string; setting?: string }

function stateBadge(state: ReadinessState): { label: string; tone: StatusTone; variant: StatusBadgeVariant } {
  switch (state) {
    case 'connected': return { label: 'Connected', tone: 'success', variant: 'solid' }
    case 'native': return { label: 'Runtime-owned', tone: 'accent', variant: 'solid' }
    case 'degraded': return { label: 'Degraded', tone: 'attention', variant: 'solid' }
    case 'connecting': return { label: 'Connecting', tone: 'neutral', variant: 'soft' }
    case 'disabled': return { label: 'Disabled', tone: 'neutral', variant: 'solid' }
    case 'missing_token': return { label: 'Missing token', tone: 'danger', variant: 'solid' }
    case 'missing_guild': return { label: 'No server', tone: 'danger', variant: 'solid' }
    case 'disconnected': return { label: 'Disconnected', tone: 'danger', variant: 'solid' }
    case 'failed': return { label: 'Failed', tone: 'danger', variant: 'solid' }
  }
}

function tokenLabel(token: ChannelReadinessPayload['token']): string {
  if (!token.present) return 'Not set'
  return token.source === 'env' ? 'Environment variable' : 'Bakin store'
}

/** Which field a readiness remediation action points at. */
function actionFieldKey(action: string | null): string | null {
  switch (action) {
    case 'enable': return 'integrations.discord.enabled'
    case 'add_token':
    case 'replace_token': return 'discord.botToken'
    case 'add_guild': return 'integrations.discord.guildIds'
    default: return null
  }
}

const FIELD_IDS: Record<string, string> = {
  'integrations.discord.enabled': 'channels-field-enabled',
  'integrations.discord.guildIds': 'channels-field-guilds',
  'integrations.discord.approvers': 'channels-field-approvers',
  'integrations.discord.inbound.enabled': 'channels-field-inbound-enabled',
  'integrations.discord.inbound.agentId': 'channels-field-inbound-agent',
  'integrations.discord.inbound.requireMention': 'channels-field-inbound-mention',
  'integrations.discord.inbound.allowFrom': 'channels-field-inbound-allow',
  'discord.botToken': 'secret-slot-discord-botToken',
  'notifications.channel': 'channels-field-alert-channel',
  'approvals.channelAlerts': 'channels-field-approvals-enabled',
  'approvals.channel': 'channels-field-approvals-channel',
}

export function fieldIdFor(setting: string | undefined): string | null {
  if (!setting) return null
  if (setting.startsWith('notifications.channelAliases.')) return 'channels-field-aliases'
  return FIELD_IDS[setting] ?? null
}

async function postJson(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string; message?: string } | null
  return body?.message ?? body?.error ?? `${fallback} (${res.status})`
}

// ── component ────────────────────────────────────────────────────────────

export function ChannelsTab({ highlightKey }: { highlightKey?: string }) {
  const readinessFetch = useJsonFetch<ChannelReadinessPayload>('/api/channels', FETCH_OPTIONS)
  const settingsFetch = useJsonFetch<{ integrations?: { discord?: DiscordSettings } }>('/api/settings', FETCH_OPTIONS)
  const secretsFetch = useJsonFetch<{ slots?: SecretSlotRow[] }>('/api/secrets', FETCH_OPTIONS)
  const refreshAll = useCallback(() => {
    void readinessFetch.refresh()
    void secretsFetch.refresh()
  }, [readinessFetch, secretsFetch])
  usePluginEvent('channels.readiness', () => { void readinessFetch.refresh() })

  const [busy, setBusy] = useState<'reconnect' | 'verify' | 'settings' | 'routing' | 'token' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifyItems, setVerifyItems] = useState<ProbeItem[] | null>(null)
  const [settlingSince, setSettlingSince] = useState<string | null>(null)

  const readiness = readinessFetch.data ?? null
  const state = readiness?.connection.state ?? null

  // A settings/token save flips the bridge to `connecting`; show
  // "reconnecting…" until the SSE-fed snapshot settles.
  useEffect(() => {
    if (settlingSince && state && state !== 'connecting') setSettlingSince(null)
  }, [settlingSince, state])

  // `?field=` focuses the owning control (the kit focus ring is the
  // highlight). The owning control may render after the snapshot (settings
  // form, token field) and the kit's Field assigns ids a tick after mount,
  // so the lookup retries briefly; it focuses each key once.
  const focusedKey = useRef<string | null>(null)
  const settingsLoaded = settingsFetch.data !== null && settingsFetch.data !== undefined
  const secretsLoaded = secretsFetch.data !== null && secretsFetch.data !== undefined
  useEffect(() => {
    const id = fieldIdFor(highlightKey)
    if (!id || !readiness || focusedKey.current === highlightKey) return
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tryFocus = () => {
      const element = document.getElementById(id)
      if (element) {
        focusedKey.current = highlightKey ?? null
        element.scrollIntoView?.({ block: 'center' })
        element.focus?.()
        return
      }
      if (attempts++ < 20) timer = setTimeout(tryFocus, 25)
    }
    tryFocus()
    return () => { if (timer) clearTimeout(timer) }
  }, [highlightKey, readiness, settingsLoaded, secretsLoaded])

  const reconnect = async () => {
    if (busy) return
    setBusy('reconnect'); setError(null)
    try {
      const res = await postJson('/api/channels/reconnect', 'POST')
      if (!res.ok && res.status !== 202) setError(await errorMessage(res, 'Reconnect was refused'))
      else setSettlingSince(new Date().toISOString())
      await readinessFetch.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const verify = async () => {
    if (busy) return
    setBusy('verify'); setError(null)
    try {
      const res = await postJson('/api/channels/verify', 'POST')
      if (!res.ok) { setError(await errorMessage(res, 'Verify was refused')); return }
      const body = await res.json() as { items: ProbeItem[] }
      setVerifyItems(body.items)
      await readinessFetch.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (readinessFetch.loading && !readiness) {
    return (
      <Stack gap="item">
        <Skeleton className="h-bakin-16 w-full" />
        <Skeleton className="h-bakin-16 w-full" />
      </Stack>
    )
  }
  if (readinessFetch.error || !readiness) {
    return (
      <SystemState
        kind="error"
        scope="section"
        recovery="available"
        title="Channel readiness could not be loaded"
        description={readinessFetch.error ?? 'No readiness snapshot was returned.'}
        action={<Button variant="outline" onClick={() => void readinessFetch.refresh()}>Try again</Button>}
      />
    )
  }

  const badge = stateBadge(readiness.connection.state)
  const isNative = readiness.owner === 'runtime'
  const settling = Boolean(settlingSince) || readiness.connection.state === 'connecting'
  const discord = settingsFetch.data?.integrations?.discord ?? null
  const slot = secretsFetch.data?.slots?.find((row) => row.provider === 'discord' && row.name === 'botToken') ?? null

  return (
    <Stack gap="section" data-testid="channels-tab" data-state={readiness.connection.state}>
      {error && (
        <Alert tone="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── status header ─────────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <Inline align="center" gap="dense" wrap>
            <h3>Delivery status</h3>
            <StatusBadge tone={badge.tone} variant={badge.variant} size="sm" data-testid="channels-state">{badge.label}</StatusBadge>
            {settling && <StatusBadge tone="neutral" variant="soft" size="sm">Reconnecting…</StatusBadge>}
          </Inline>
          <KeyValue
            layout="rows"
            items={[
              { label: 'Runtime', value: `${readiness.runtime.adapter} (delivery ${readiness.runtime.deliveryMode})` },
              { label: 'Owner', value: isNative ? 'The runtime delivers natively' : 'Bakin Discord bridge' },
              { label: 'Enabled', value: readiness.enabled ? 'Yes' : 'No' },
              { label: 'Bot token', value: tokenLabel(readiness.token) },
              { label: 'Connection', value: `${readiness.connection.state.replace(/_/g, ' ')} since ${readiness.connection.since}` },
              ...(readiness.connection.botUser ? [{ label: 'Bot', value: `${readiness.connection.botUser.name} (${readiness.connection.botUser.id})`, mono: true }] : []),
            ]}
          />
        </Stack>
        {readiness.remediation && !isNative && (
          <Banner
            tone={readiness.connection.state === 'connecting' || readiness.connection.state === 'degraded' ? 'attention' : 'danger'}
            announce="polite"
            headingLevel={4}
            title={readiness.remediation.summary}
            description={
              <>
                {readiness.remediation.nextStep}
                {readiness.connection.lastError ? ` Last error: ${readiness.connection.lastError.kind} — ${readiness.connection.lastError.message}.` : ''}
              </>
            }
            action={
              readiness.remediation.action === 'reconnect' || readiness.remediation.action === 'fix_intents' || readiness.remediation.action === 'wait' ? (
                <Button size="sm" onClick={() => void reconnect()} disabled={busy !== null || settling}>Reconnect</Button>
              ) : actionFieldKey(readiness.remediation.action) ? (
                <Button size="sm" variant="outline" onClick={() => document.getElementById(fieldIdFor(actionFieldKey(readiness.remediation!.action)!) ?? '')?.focus()}>
                  {readiness.remediation.action === 'enable' ? 'Enable' : readiness.remediation.action === 'add_guild' ? 'Add a server' : 'Add the token'}
                </Button>
              ) : undefined
            }
          />
        )}
        {isNative && (
          <Text size="meta" tone="muted" as="p">
            {readiness.runtime.adapter} owns channel delivery with its own bot and token. The Bakin bridge settings below are idle configuration — they take effect only on a runtime without native delivery.
          </Text>
        )}
      </Section>

      {/* ── bridge settings ───────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <h3>Discord bridge</h3>
          <Text size="meta" tone="muted" as="p">Non-secret configuration. Saving reconnects the bridge; disabling stops it immediately.</Text>
        </Stack>
        {settingsFetch.loading && !discord ? (
          <Skeleton className="h-bakin-16 w-full" />
        ) : !discord ? (
          <SystemState kind="error" scope="section" title="Settings could not be loaded" description={settingsFetch.error ?? 'No settings were returned.'} action={<Button variant="outline" onClick={() => void settingsFetch.refresh()}>Try again</Button>} />
        ) : (
          <BridgeSettingsForm
            initial={discord}
            disabled={busy !== null}
            onSaved={() => { setSettlingSince(new Date().toISOString()); void settingsFetch.refresh(); void readinessFetch.refresh() }}
            onBusy={(on) => setBusy(on ? 'settings' : null)}
            onError={setError}
          />
        )}
      </Section>

      {/* ── bot token ─────────────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <h3>Bot token</h3>
          <Text size="meta" tone="muted" as="p">
            Stored in Bakin&apos;s secret store, never shown back. A runtime-owned token (OpenClaw&apos;s own Discord config) is a separate credential — Bakin never reads it.
          </Text>
        </Stack>
        {slot ? (
          <SecretSlotField
            slot={slot}
            busy={busy !== null}
            onSet={async (value) => {
              setBusy('token'); setError(null)
              try {
                const res = await postJson('/api/secrets', 'POST', { provider: slot.provider, name: slot.name, value })
                if (!res.ok) { setError(await errorMessage(res, 'The token was not saved')); return false }
                setSettlingSince(new Date().toISOString())
                refreshAll()
                return true
              } finally {
                setBusy(null)
              }
            }}
            onClear={async () => {
              setBusy('token'); setError(null)
              try {
                const res = await fetch(`/api/secrets?provider=${encodeURIComponent(slot.provider)}&name=${encodeURIComponent(slot.name)}`, { method: 'DELETE' })
                if (!res.ok) { setError(await errorMessage(res, 'The token was not cleared')); return false }
                refreshAll()
                return true
              } finally {
                setBusy(null)
              }
            }}
          />
        ) : (
          <Skeleton className="h-bakin-12 w-full" />
        )}
      </Section>

      {/* ── servers & channels ────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <h3>Servers &amp; channels</h3>
          <Text size="meta" tone="muted" as="p">
            {isNative
              ? `Channels the runtime (${readiness.runtime.adapter}) lists — read-only here.`
              : 'What the bridge actually joined and enumerated, refreshed on every reconnect and Verify.'}
          </Text>
        </Stack>
        <ServersAndChannels readiness={readiness} />
      </Section>

      {/* ── routing ───────────────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <h3>Routing</h3>
          <Text size="meta" tone="muted" as="p">Where alerts and approval cards go, and the aliases agents may post to. Verify checks every target below.</Text>
        </Stack>
        <RoutingForm
          readiness={readiness}
          disabled={busy !== null}
          onBusy={(on) => setBusy(on ? 'routing' : null)}
          onSaved={() => void readinessFetch.refresh()}
          onError={setError}
        />
      </Section>

      {/* ── actions ───────────────────────────────────────────────────── */}
      <Section spacing="compact">
        <Stack gap="dense">
          <h3>Connection</h3>
          <Inline gap="dense" wrap>
            <Button
              onClick={() => void reconnect()}
              disabled={busy !== null || isNative || settling}
              aria-label="Reconnect the Discord bridge"
            >
              {busy === 'reconnect' ? 'Reconnecting…' : 'Reconnect'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void verify()}
              disabled={busy !== null || readiness.connection.state === 'connecting'}
              aria-label="Verify channel delivery"
            >
              {busy === 'verify' ? 'Verifying…' : 'Verify'}
            </Button>
            <Text size="meta" tone="muted">
              {isNative ? 'Reconnect is for the Bakin bridge; the runtime keeps its own connection.' : 'Verify is read-only — it never posts a message.'}
            </Text>
          </Inline>
        </Stack>
        {verifyItems && <VerifyResults items={verifyItems} />}
      </Section>
    </Stack>
  )
}

// ── bridge settings form ─────────────────────────────────────────────────

function BridgeSettingsForm({ initial, disabled, onSaved, onBusy, onError }: {
  initial: DiscordSettings
  disabled: boolean
  onSaved(): void
  onBusy(on: boolean): void
  onError(message: string | null): void
}) {
  const [draft, setDraft] = useState<DiscordSettings>(initial)
  const loadedKey = useRef(JSON.stringify(initial))
  useEffect(() => {
    const key = JSON.stringify(initial)
    if (key !== loadedKey.current) { loadedKey.current = key; setDraft(initial) }
  }, [initial])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const save = async () => {
    onBusy(true); onError(null)
    try {
      const res = await postJson('/api/settings', 'POST', { integrations: { discord: draft } })
      if (!res.ok) { onError(await errorMessage(res, 'Bridge settings were not saved')); return }
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy(false)
    }
  }

  return (
    <Form aria-label="Discord bridge settings" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Stack gap="item">
        <Field orientation="horizontal" name="discord-enabled">
          <Switch id={FIELD_IDS['integrations.discord.enabled']} size="sm" checked={draft.enabled} disabled={disabled} onCheckedChange={(checked: boolean) => setDraft({ ...draft, enabled: checked })} />
          <FieldLabel htmlFor={FIELD_IDS['integrations.discord.enabled']}>Discord delivery enabled</FieldLabel>
          <FieldDescription>Also needs a bot token and at least one server. Off stops approval decisions immediately.</FieldDescription>
        </Field>
        <Field name="discord-guilds">
          <FieldLabel htmlFor={FIELD_IDS['integrations.discord.guildIds']}>Servers (guild IDs)</FieldLabel>
          <FieldDescription>The Discord servers whose text channels the bridge serves. The bot must be a member of each.</FieldDescription>
          <IdListEditor label="Server IDs" inputId={FIELD_IDS['integrations.discord.guildIds']} values={draft.guildIds} disabled={disabled} onChange={(guildIds) => setDraft({ ...draft, guildIds })} placeholder="Guild ID" emptyText="No servers configured." />
        </Field>
        <Field name="discord-approvers">
          <FieldLabel htmlFor={FIELD_IDS['integrations.discord.approvers']}>Approvers (Discord user IDs)</FieldLabel>
          <FieldDescription>Who may decide approval gates from Discord. Empty = nobody (fail closed).</FieldDescription>
          <IdListEditor label="Approver IDs" inputId={FIELD_IDS['integrations.discord.approvers']} values={draft.approvers} disabled={disabled} onChange={(approvers) => setDraft({ ...draft, approvers })} placeholder="User ID" emptyText="No approvers — every approval click is denied." />
        </Field>
        <Field orientation="horizontal" name="discord-inbound-enabled">
          <Switch id={FIELD_IDS['integrations.discord.inbound.enabled']} size="sm" checked={draft.inbound.enabled} disabled={disabled} onCheckedChange={(checked: boolean) => setDraft({ ...draft, inbound: { ...draft.inbound, enabled: checked } })} />
          <FieldLabel htmlFor={FIELD_IDS['integrations.discord.inbound.enabled']}>Inbound chat</FieldLabel>
          <FieldDescription>Allowlisted users can chat with a Bakin agent from Discord; replies post back to the channel.</FieldDescription>
        </Field>
        <Grid layout="split" gap="item">
          <Field name="discord-inbound-agent">
            <FieldLabel htmlFor={FIELD_IDS['integrations.discord.inbound.agentId']}>Inbound agent</FieldLabel>
            <Input id={FIELD_IDS['integrations.discord.inbound.agentId']} value={draft.inbound.agentId} disabled={disabled} onChange={(event) => setDraft({ ...draft, inbound: { ...draft.inbound, agentId: event.target.value } })} />
          </Field>
          <Field orientation="horizontal" name="discord-inbound-mention">
            <Switch id={FIELD_IDS['integrations.discord.inbound.requireMention']} size="sm" checked={draft.inbound.requireMention} disabled={disabled} onCheckedChange={(checked: boolean) => setDraft({ ...draft, inbound: { ...draft.inbound, requireMention: checked } })} />
            <FieldLabel htmlFor={FIELD_IDS['integrations.discord.inbound.requireMention']}>Require @mention in channels</FieldLabel>
          </Field>
        </Grid>
        <Field name="discord-inbound-allow">
          <FieldLabel htmlFor={FIELD_IDS['integrations.discord.inbound.allowFrom']}>Inbound allowlist (Discord user IDs)</FieldLabel>
          <FieldDescription>Who may chat with the bot. Empty = nobody (fail closed).</FieldDescription>
          <IdListEditor label="Inbound allowlist IDs" inputId={FIELD_IDS['integrations.discord.inbound.allowFrom']} values={draft.inbound.allowFrom} disabled={disabled} onChange={(allowFrom) => setDraft({ ...draft, inbound: { ...draft.inbound, allowFrom } })} placeholder="User ID" emptyText="No senders allowed." />
        </Field>
        <FormActions>
          <Button type="submit" size="sm" disabled={disabled || !dirty}>Save bridge settings</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !dirty} onClick={() => setDraft(initial)}>Discard</Button>
        </FormActions>
      </Stack>
    </Form>
  )
}

// ── servers & channels ───────────────────────────────────────────────────

function ServersAndChannels({ readiness }: { readiness: ChannelReadinessPayload }) {
  const columns: ReadonlyArray<DataTableColumn<ChannelItem>> = [
    { key: 'label', header: 'Channel', narrow: 'primary', cellClassName: 'whitespace-normal break-all', cell: (row) => row.label },
    {
      key: 'id', header: 'ID', narrow: 'meta', cellClassName: 'whitespace-normal break-all', cell: (row) => (
        <Inline gap="dense" align="center">
          <Text size="meta" mono className="min-w-0 break-all">{row.id}</Text>
          <CopyButton text={row.id} label={`Copy ${row.id}`} />
        </Inline>
      ),
    },
    { key: 'caps', header: 'Capabilities', narrow: 'label', cell: (row) => <Text size="meta" tone="muted">{row.capabilities.length} ({row.capabilities.includes('interactive-approval') ? 'approvals' : 'messages'})</Text> },
  ]
  return (
    <Stack gap="item">
      {readiness.owner === 'bridge' && readiness.guilds.length > 0 && (
        <ListRows aria-label="Servers" variant="separated">
          {readiness.guilds.map((guild) => {
            const joined = guild.joined === null ? { label: 'Unknown', tone: 'neutral' as const } : guild.joined ? { label: 'Joined', tone: 'success' as const } : { label: 'Not joined', tone: 'danger' as const }
            return (
              <ListRow key={guild.id}>
                <Inline align="center" justify="between" gap="dense" wrap>
                  <Text size="body" mono className="min-w-0 break-all">{guild.name ? `${guild.name} · ${guild.id}` : guild.id}</Text>
                  <Inline gap="dense" align="center">
                    {guild.channelCount !== null && <Text size="meta" tone="muted">{guild.channelCount} channel{guild.channelCount === 1 ? '' : 's'}</Text>}
                    <StatusBadge size="xs" tone={joined.tone} variant="solid">{joined.label}</StatusBadge>
                  </Inline>
                </Inline>
                {guild.error && <Text size="meta" tone="muted" as="p">{guild.error.kind}: {guild.error.message}</Text>}
              </ListRow>
            )
          })}
        </ListRows>
      )}
      {readiness.channels.error && (
        <Text size="meta" tone="muted" as="p">Channel list: {readiness.channels.error.message}{readiness.channels.collectedAt ? ` (showing the list from ${readiness.channels.collectedAt})` : ''}</Text>
      )}
      {readiness.channels.items.length > 0 ? (
        <DataTable label="Channels" columns={columns} rows={readiness.channels.items} rowKey={(row) => row.id} collapseBelow="xl" listVariant="separated" />
      ) : (
        <Text size="meta" tone="muted" as="p">
          {readiness.channels.source === 'none' ? 'No channel list until delivery is connected.' : 'No text channels were listed.'}
        </Text>
      )}
    </Stack>
  )
}

// ── routing ──────────────────────────────────────────────────────────────

interface RoutingDraft {
  alertChannel: string
  approvalsEnabled: boolean
  approvalsChannel: string
  aliases: Array<{ name: string; target: string }>
}

function routingDraftFrom(readiness: ChannelReadinessPayload): RoutingDraft {
  return {
    alertChannel: readiness.routing.alertChannel.value ?? '',
    approvalsEnabled: readiness.routing.approvalsEnabled,
    approvalsChannel: readiness.routing.approvalsChannel.value ?? '',
    aliases: readiness.routing.aliases.map((alias) => ({ name: alias.setting.replace('notifications.channelAliases.', ''), target: alias.value ?? '' })),
  }
}

function ChannelTargetField({ id, label, value, channels, disabled, onChange, resolved }: {
  id: string
  label: string
  value: string
  channels: ChannelItem[]
  disabled: boolean
  onChange(next: string): void
  resolved?: RoutingTarget['resolved']
}) {
  const options = useMemo(() => Object.fromEntries(channels.map((channel) => [channel.id, `${channel.label} (${channel.id})`])), [channels])
  const known = value === '' || Object.prototype.hasOwnProperty.call(options, value)
  return (
    <Field name={id}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {channels.length > 0 && known ? (
        <Select items={{ '': 'Not set', ...options }} value={value} onValueChange={(next: string | null) => onChange(next ?? '')} disabled={disabled}>
          <SelectTrigger id={id} width="full"><SelectValue placeholder="Not set" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">Not set</SelectItem>
            {channels.map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.label} ({channel.id})</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} value={value} disabled={disabled} placeholder="discord:channel:<id> or an alias" onChange={(event) => onChange(event.target.value)} />
      )}
      {resolved === 'unknown_channel' && <FieldDescription>Does not resolve to a known channel.</FieldDescription>}
      {resolved === 'unverifiable' && <FieldDescription>Cannot be checked until a channel list is available.</FieldDescription>}
    </Field>
  )
}

function RoutingForm({ readiness, disabled, onBusy, onSaved, onError }: {
  readiness: ChannelReadinessPayload
  disabled: boolean
  onBusy(on: boolean): void
  onSaved(): void
  onError(message: string | null): void
}) {
  const [draft, setDraft] = useState<RoutingDraft>(() => routingDraftFrom(readiness))
  const loadedKey = useRef(JSON.stringify(readiness.routing))
  useEffect(() => {
    const key = JSON.stringify(readiness.routing)
    if (key !== loadedKey.current) { loadedKey.current = key; setDraft(routingDraftFrom(readiness)) }
  }, [readiness])
  const [newAlias, setNewAlias] = useState({ name: '', target: '' })
  const dirty = JSON.stringify(draft) !== JSON.stringify(routingDraftFrom(readiness))
  const channels = readiness.channels.items

  const save = async () => {
    onBusy(true); onError(null)
    try {
      const aliases: Record<string, string> = {}
      for (const alias of draft.aliases) if (alias.name.trim() && alias.target.trim()) aliases[alias.name.trim()] = alias.target.trim()
      const res = await postJson('/api/channels/routing', 'PUT', {
        alertChannel: draft.alertChannel.trim() || null,
        approvalsEnabled: draft.approvalsEnabled,
        approvalsChannel: draft.approvalsChannel.trim() || null,
        aliases,
      })
      if (!res.ok) { onError(await errorMessage(res, 'Routing was not saved')); return }
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy(false)
    }
  }

  const addAlias = () => {
    const name = newAlias.name.trim().toLowerCase()
    const target = newAlias.target.trim()
    if (!name || !target) return
    setDraft({ ...draft, aliases: [...draft.aliases.filter((alias) => alias.name !== name), { name, target }] })
    setNewAlias({ name: '', target: '' })
  }

  return (
    <Form aria-label="Channel routing" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Stack gap="item">
        <ChannelTargetField id={FIELD_IDS['notifications.channel']} label="Alert channel" value={draft.alertChannel} channels={channels} disabled={disabled} onChange={(alertChannel) => setDraft({ ...draft, alertChannel })} resolved={readiness.routing.alertChannel.resolved} />
        <Field orientation="horizontal" name="approvals-enabled">
          <Switch id={FIELD_IDS['approvals.channelAlerts']} size="sm" checked={draft.approvalsEnabled} disabled={disabled} onCheckedChange={(checked: boolean) => setDraft({ ...draft, approvalsEnabled: checked })} />
          <FieldLabel htmlFor={FIELD_IDS['approvals.channelAlerts']}>Approval cards on the channel</FieldLabel>
          <FieldDescription>Render pending approvals as cards with buttons; decisions from the card and from the board resolve the same record.</FieldDescription>
        </Field>
        <ChannelTargetField id={FIELD_IDS['approvals.channel']} label="Approvals channel" value={draft.approvalsChannel} channels={channels} disabled={disabled || !draft.approvalsEnabled} onChange={(approvalsChannel) => setDraft({ ...draft, approvalsChannel })} resolved={draft.approvalsEnabled ? readiness.routing.approvalsChannel.resolved : undefined} />

        <Stack gap="dense">
          <Text as="h4" weight="medium">Aliases</Text>
          <Text size="meta" tone="muted" as="p">Names agents may post to (for example <Text as="span" mono>alerts</Text>). Removing a row deletes the alias when you save.</Text>
          {draft.aliases.length === 0 ? (
            <Text size="meta" tone="muted" as="p">No aliases.</Text>
          ) : (
            <ListRows aria-label="Aliases" variant="separated">
              {draft.aliases.map((alias, index) => (
                <ListRow key={alias.name}>
                  <Grid layout="split" gap="item">
                    <Field name={`alias-${alias.name}-name`}>
                      <FieldLabel htmlFor={`channels-alias-${index}-name`}>Alias</FieldLabel>
                      <Input id={`channels-alias-${index}-name`} value={alias.name} disabled={disabled} onChange={(event) => setDraft({ ...draft, aliases: draft.aliases.map((row, i) => i === index ? { ...row, name: event.target.value.toLowerCase() } : row) })} />
                    </Field>
                    <Inline align="end" gap="dense">
                      <ChannelTargetField id={`channels-alias-${index}-target`} label="Channel" value={alias.target} channels={channels} disabled={disabled} onChange={(target) => setDraft({ ...draft, aliases: draft.aliases.map((row, i) => i === index ? { ...row, target } : row) })} resolved={readiness.routing.aliases.find((row) => row.setting.endsWith(`.${alias.name}`))?.resolved} />
                      <Button type="button" variant="ghost" size="xs" aria-label={`Remove alias ${alias.name}`} disabled={disabled} onClick={() => setDraft({ ...draft, aliases: draft.aliases.filter((_, i) => i !== index) })}>Remove</Button>
                    </Inline>
                  </Grid>
                </ListRow>
              ))}
            </ListRows>
          )}
          <Grid layout="split" gap="item">
            <Field name="new-alias-name">
              <FieldLabel htmlFor="channels-field-aliases">New alias</FieldLabel>
              <Input id="channels-field-aliases" value={newAlias.name} disabled={disabled} placeholder="alerts" onChange={(event) => setNewAlias({ ...newAlias, name: event.target.value })} />
            </Field>
            <Inline align="end" gap="dense">
              <ChannelTargetField id="channels-field-aliases-target" label="Channel" value={newAlias.target} channels={channels} disabled={disabled} onChange={(target) => setNewAlias({ ...newAlias, target })} />
              <Button type="button" size="sm" variant="outline" aria-label="Add alias" disabled={disabled || !newAlias.name.trim() || !newAlias.target.trim()} onClick={addAlias}>Add</Button>
            </Inline>
          </Grid>
        </Stack>

        <FormActions>
          <Button type="submit" size="sm" disabled={disabled || !dirty}>Save routing</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !dirty} onClick={() => setDraft(routingDraftFrom(readiness))}>Discard</Button>
        </FormActions>
      </Stack>
    </Form>
  )
}

// ── verify results ───────────────────────────────────────────────────────

function VerifyResults({ items }: { items: ProbeItem[] }) {
  const tone = (status: ProbeItem['status']): StatusTone => status === 'pass' ? 'success' : status === 'fail' ? 'danger' : 'neutral'
  return (
    <ListRows aria-label="Verify results" variant="separated" data-testid="channels-verify-results">
      {items.map((item) => {
        const fieldId = fieldIdFor(item.setting)
        return (
          <ListRow key={item.key}>
            <Inline align="center" justify="between" gap="dense" wrap>
              <Stack gap="dense" className="min-w-0">
                <Text size="body" className="min-w-0 break-words">{item.summary}</Text>
                {item.detail && <Text size="meta" tone="muted" as="p" className="min-w-0 break-words">{item.detail}</Text>}
                {item.setting && (
                  <Text size="meta" tone="muted" as="p">
                    <PluginLink to={`/settings?tab=channels&field=${encodeURIComponent(item.setting)}`}>Open {item.setting}</PluginLink>
                    {fieldId ? null : null}
                  </Text>
                )}
              </Stack>
              <StatusBadge size="xs" tone={tone(item.status)} variant="solid">{item.status.toUpperCase()}</StatusBadge>
            </Inline>
          </ListRow>
        )
      })}
    </ListRows>
  )
}
