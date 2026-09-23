'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Inline, Section, Stack } from '@makinbakin/sdk/layout'
import { AgentAvatar, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Form,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'

import type { BudgetRuleWire } from '../types'
import type { SpendData } from './use-spend-data'
import { parseCapInput } from './spend-utils'

const SCOPES = ['global', 'agent', 'provider', 'model'] as const

function RuleSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onValueChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next ?? value)}>
      <SelectTrigger size="sm" aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A cap field keeps the TEXT the operator typed ("2." on the way to "2.5",
 * "5k") and commits the parsed number as it becomes valid; a value that
 * arrives from outside (reload, discard) replaces the text. Placeholders
 * name the unit only — never an example number (spec: no example amounts).
 */
function CapInput({
  rule,
  label,
  ariaLabel,
  value,
  onChange,
}: {
  rule: BudgetRuleWire
  label: string
  ariaLabel: string
  value: number | undefined
  onChange: (value: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    // Sync only when the committed value diverges from what the text parses
    // to — typing "2." (unparseable) must not be clobbered by the stale prop.
    const parsed = parseCapInput(text)
    if (parsed !== value && !(value === undefined && text.trim() !== '' && parsed === undefined)) {
      setText(value === undefined ? '' : String(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <Field name={label}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={rule.lane === 'metered' ? 'Dollars' : 'Tokens (k or M suffix)'}
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value
          setText(next)
          const parsed = parseCapInput(next)
          if (parsed !== undefined || next.trim() === '') onChange(parsed)
        }}
      />
    </Field>
  )
}

/** A stable React key per editor row: the saved id, else the staging key the row was created with. */
function rowKey(rule: BudgetRuleWire, index: number): string {
  return rule.id ?? rule.stagedKey ?? `row-${index}`
}

function BudgetRuleRow({
  index,
  rule,
  rules,
  m,
}: {
  index: number
  rule: BudgetRuleWire
  rules: BudgetRuleWire[]
  m: SpendData
}) {
  const edit = (patch: Partial<BudgetRuleWire>) => {
    m.setPendingRules(rules.map((current, currentIndex) => (
      currentIndex === index ? { ...current, ...patch } : current
    )))
  }
  const scopeCandidates = rule.scope === 'agent'
    ? m.agents.map((agent) => agent.agentId)
    : rule.scope === 'provider'
      ? m.availableProviders
      : m.modelIds

  return (
    <ListRow className="px-bakin-4 py-bakin-4">
      <Field name={`budget-rule-${index}-scope`}>
        <FieldLabel>Scope</FieldLabel>
        <RuleSelect
          label={`Budget rule ${index + 1} scope`}
          value={rule.scope}
          options={SCOPES.map((scope) => ({
            value: scope,
            label: scope[0]!.toUpperCase() + scope.slice(1),
          }))}
          onValueChange={(scope) => edit({
            scope: scope as BudgetRuleWire['scope'],
            ...(scope === 'global' ? { scopeId: undefined } : {}),
          })}
        />
      </Field>

      {rule.scope === 'global' ? (
        <div className="hidden @5xl/list-rows:block" aria-hidden="true" />
      ) : (
        <Field name={`budget-rule-${index}-scope-id`}>
          <FieldLabel>Scope ID</FieldLabel>
          <Input
            list={`budget-rule-${index}-scope-candidates`}
            aria-label={`Budget rule ${index + 1} scope ID`}
            placeholder={rule.scope === 'agent' ? 'Agent ID' : rule.scope === 'provider' ? 'Provider' : 'Provider/model'}
            value={rule.scopeId ?? ''}
            onChange={(event) => edit({ scopeId: event.currentTarget.value || undefined })}
          />
          <datalist id={`budget-rule-${index}-scope-candidates`}>
            {scopeCandidates.map((candidate) => <option key={candidate} value={candidate} />)}
          </datalist>
        </Field>
      )}

      <Field name={`budget-rule-${index}-lane`}>
        <FieldLabel>Billing lane</FieldLabel>
        <RuleSelect
          label={`Budget rule ${index + 1} billing lane`}
          value={rule.lane}
          options={[
            { value: 'metered', label: 'Metered dollars' },
            { value: 'subscription', label: 'Subscription tokens' },
          ]}
          onValueChange={(lane) => edit({ lane: lane as BudgetRuleWire['lane'] })}
        />
      </Field>

      <CapInput
        rule={rule}
        label="Daily cap"
        ariaLabel={`Budget rule ${index + 1} daily cap`}
        value={rule.dailyCap}
        onChange={(dailyCap) => edit({ dailyCap })}
      />
      <CapInput
        rule={rule}
        label="Monthly cap"
        ariaLabel={`Budget rule ${index + 1} monthly cap`}
        value={rule.monthlyCap}
        onChange={(monthlyCap) => edit({ monthlyCap })}
      />

      <Field name={`budget-rule-${index}-cap-action`}>
        <FieldLabel>At cap</FieldLabel>
        <RuleSelect
          label={`Budget rule ${index + 1} cap action`}
          value={rule.atCap ?? 'defer'}
          options={[
            { value: 'defer', label: 'Wait for the next period' },
            { value: 'pause', label: 'Pause until resumed' },
          ]}
          onValueChange={(atCap) => edit({ atCap: atCap as BudgetRuleWire['atCap'] })}
        />
      </Field>

      <Button
        type="button"
        variant="danger"
        size="icon-sm"
        aria-label={`Remove budget rule ${index + 1}`}
        onClick={() => m.setPendingRules(rules.filter((_, currentIndex) => currentIndex !== index))}
      >
        <Trash2 />
      </Button>
    </ListRow>
  )
}

let stagedRowSeq = 0

export function BudgetRulesSection({ m, onAddLimit }: { m: SpendData; onAddLimit: () => void }) {
  // `null` = the current limits have not loaded (failed or pending): the
  // editor cannot show "No spending limits" for a policy it does not know,
  // and nothing can be added to a list that might replace unseen rules.
  const rules = m.pendingRules ?? m.budgetRules
  const unavailable = rules === null

  return (
    <Section className="@container/budget-rules" spacing="compact" divider="top" aria-label="Budget rules">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/budget-rules:flex-row @2xl/budget-rules:items-start @2xl/budget-rules:justify-between">
        <Stack gap="dense">
          <h2>Budget rules</h2>
          <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
            Cap estimated metered cost or subscription-token usage by day or month — one rule per scope and lane, with both caps on it. At the cap, work can wait for the next period or pause until you resume it.
          </Text>
        </Stack>
        <div className="flex w-full shrink-0 flex-col gap-bakin-2 @2xl/budget-rules:w-auto @2xl/budget-rules:flex-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unavailable}
            onClick={() => m.setPendingRules([
              ...(rules ?? []),
              { scope: 'global', lane: 'metered', atCap: 'defer', stagedKey: `staged-${++stagedRowSeq}` },
            ])}
          >
            Add a rule
          </Button>
          <Button type="button" size="sm" disabled={unavailable} onClick={onAddLimit}>
            <Plus />
            Add a limit
          </Button>
        </div>
      </div>

      {rules === null ? (
        <SystemState
          kind="error"
          scope="section"
          recovery="unavailable"
          title="Spend limits could not be loaded"
          description="The current limits are unknown, so nothing can be edited or added until they load — otherwise a save could replace limits you have not seen."
        />
      ) : rules.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          title="No spending limits"
          description="Bakin records everything; set a limit once you know what normal looks like. You'll be told at 50, 75 and 90% on the way up."
          action={(
            <Button type="button" size="sm" onClick={onAddLimit}>
              <Plus />
              Add a limit
            </Button>
          )}
        />
      ) : (
        <Form
          aria-label="Budget rule settings"
          onSubmit={(event) => event.preventDefault()}
        >
          <ListRows
            aria-label="Budget rules"
            variant="separated"
            columns="minmax(9rem,.7fr) minmax(10rem,1fr) minmax(9rem,.7fr) minmax(8rem,.7fr) minmax(8rem,.7fr) minmax(8rem,.6fr) auto"
            columnsAt="5xl"
            columnsAlign="end"
          >
            {rules.map((rule, index) => (
              <BudgetRuleRow
                key={rowKey(rule, index)}
                index={index}
                rule={rule}
                rules={rules}
                m={m}
              />
            ))}
          </ListRows>
        </Form>
      )}
    </Section>
  )
}

export function BillingLanesSection({ m }: { m: SpendData }) {
  const billing = Object.entries(m.budgetStatus?.billing ?? {})
  const overrides = m.budgetStatus?.overrides ?? []
  const agentOverrides = new Map(
    overrides
      .filter((override) => override.agentId && !override.provider)
      .map((override) => [override.agentId as string, override.lane]),
  )

  return (
    <Section className="@container/billing-lanes" spacing="compact" divider="top" aria-label="Billing lanes">
      <Stack gap="dense">
        <h2>Billing lanes</h2>
        <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
          Bakin detects whether each agent uses metered API billing or subscription tokens. Override a lane only when authentication lives outside the agent profile.
        </Text>
      </Stack>

      {billing.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          title="No billing lanes detected"
          description="Agent billing lanes appear after the runtime reports model authentication."
        />
      ) : (
        <ListRows
          aria-label="Agent billing lanes"
          variant="separated"
          columns="minmax(12rem,1fr) minmax(11rem,.7fr)"
          columnsAt="2xl"
        >
          {billing.map(([agentId, lane]) => {
            const agent = m.agents.find((candidate) => candidate.agentId === agentId)
            const value = agentOverrides.get(agentId) ?? 'auto'
            return (
              <ListRow key={agentId} className="px-bakin-4 py-bakin-4">
                <Inline wrap={false}>
                  <AgentAvatar
                    agent={{ id: agentId, name: agent?.name ?? agentId }}
                    size="md"
                    decorative
                  />
                  <div className="min-w-0">
                    <p className="font-bakin-typography-weight-semibold text-bakin-text-primary">
                      {agent?.name ?? agentId}
                    </p>
                    <Text size="meta" tone="muted" as="p" className="mt-bakin-1">
                      {lane.provider} · detected {lane.lane}
                    </Text>
                  </div>
                </Inline>

                <Field name={`billing-lane-${agentId}`}>
                  <FieldLabel>Billing override</FieldLabel>
                  <FieldDescription>Auto follows the detected authentication.</FieldDescription>
                  <RuleSelect
                    label={`${agent?.name ?? agentId} billing override`}
                    value={value}
                    options={[
                      { value: 'auto', label: `Auto · ${lane.lane}` },
                      { value: 'metered', label: 'Metered dollars' },
                      { value: 'subscription', label: 'Subscription tokens' },
                    ]}
                    onValueChange={(next) => void m.setAgentLaneOverride(
                      agentId,
                      next as 'auto' | 'metered' | 'subscription',
                    )}
                  />
                </Field>
              </ListRow>
            )
          })}
        </ListRows>
      )}
    </Section>
  )
}
