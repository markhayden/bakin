'use client'

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
} from '@makinbakin/sdk/ui'

import type { BudgetRuleWire, ModelsData } from './use-models-data'
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
  return (
    <Field name={label}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={rule.lane === 'metered' ? 'e.g. 25' : 'e.g. 5M'}
        value={value ?? ''}
        onChange={(event) => onChange(parseCapInput(event.currentTarget.value))}
      />
    </Field>
  )
}

function BudgetRuleRow({
  index,
  rule,
  m,
}: {
  index: number
  rule: BudgetRuleWire
  m: ModelsData
}) {
  const rules = m.pendingRules ?? m.budgetRules
  const edit = (patch: Partial<BudgetRuleWire>) => {
    m.setPendingRules(rules.map((current, currentIndex) => (
      currentIndex === index ? { ...current, ...patch } : current
    )))
  }
  const scopeCandidates = rule.scope === 'agent'
    ? m.agents.map((agent) => agent.agentId)
    : rule.scope === 'provider'
      ? m.availableProviders
      : m.modelOptions.map((model) => model.id)

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

      <Field name={`budget-rule-${index}-warning`}>
        <FieldLabel>Warn at</FieldLabel>
        <Input
          type="number"
          min="1"
          max="100"
          aria-label={`Budget rule ${index + 1} warning percent`}
          placeholder="80"
          value={rule.warnPct !== undefined ? Math.round(rule.warnPct * 100) : ''}
          onChange={(event) => edit({
            warnPct: event.currentTarget.value
              ? Number(event.currentTarget.value) / 100
              : undefined,
          })}
        />
      </Field>

      <Field name={`budget-rule-${index}-cap-action`}>
        <FieldLabel>At cap</FieldLabel>
        <RuleSelect
          label={`Budget rule ${index + 1} cap action`}
          value={rule.atCap ?? 'defer'}
          options={[
            { value: 'defer', label: 'Defer work' },
            { value: 'pause', label: 'Pause dispatch' },
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

export function BudgetRulesSection({ m }: { m: ModelsData }) {
  const rules = m.pendingRules ?? m.budgetRules

  return (
    <Section className="@container/budget-rules" spacing="compact" divider="top" aria-label="Budget rules">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/budget-rules:flex-row @2xl/budget-rules:items-start @2xl/budget-rules:justify-between">
        <Stack gap="dense">
          <h2>Budget rules</h2>
          <p className="max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
            Cap estimated metered cost or subscription-token usage by day or month. At the cap, work can defer until reset or pause until an operator resumes it.
          </p>
        </Stack>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 @2xl/budget-rules:w-auto"
          onClick={() => m.setPendingRules([
            ...rules,
            { scope: 'global', lane: 'metered', warnPct: 0.8, atCap: 'defer' },
          ])}
        >
          <Plus />
          Add budget rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          title="Spend is not capped"
          description="Add a rule when this workspace needs a daily or monthly safety limit."
          action={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => m.setPendingRules([
                { scope: 'global', lane: 'metered', warnPct: 0.8, atCap: 'defer' },
              ])}
            >
              Add budget rule
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
            columns="minmax(9rem,.7fr) minmax(10rem,1fr) minmax(9rem,.7fr) minmax(8rem,.7fr) minmax(8rem,.7fr) minmax(7rem,.5fr) minmax(8rem,.6fr) auto"
            columnsAt="5xl"
            columnsAlign="end"
          >
            {rules.map((rule, index) => (
              <BudgetRuleRow
                key={`${rule.scope}-${rule.scopeId ?? 'global'}-${rule.lane}-${index}`}
                index={index}
                rule={rule}
                m={m}
              />
            ))}
          </ListRows>
        </Form>
      )}
    </Section>
  )
}

export function BillingLanesSection({ m }: { m: ModelsData }) {
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
        <p className="max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          Bakin detects whether each agent uses metered API billing or subscription tokens. Override a lane only when authentication lives outside the agent profile.
        </p>
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
                    <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
                      {lane.provider} · detected {lane.lane}
                    </p>
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
