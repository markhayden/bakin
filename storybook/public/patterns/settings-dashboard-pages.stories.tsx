import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import {
  DashboardPage,
  DashboardPageContent,
  PageHeader,
  SettingsPage,
  SettingsPageBody,
  SettingsPageContent,
  SettingsPageNavigation,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Banner,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Switch,
  SystemState,
} from '@makinbakin/sdk/ui'

import './settings-dashboard-pages.stories.css'

const meta = {
  title: 'Patterns/Settings and dashboard pages',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SettingsPage provides a responsive named category/form frame with content, wide, and full plugin-canvas widths; DashboardPage provides a prioritized state-aware overview canvas. Both preserve the existing routing contract and leave data, dirty state, saves, telemetry, and domain actions to consumers.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const categories = ['System and alerts', 'Integrations and keys', 'Official plugins', 'Extensions'] as const
type Category = (typeof categories)[number]

function SettingsCategoriesExample() {
  const [category, setCategory] = useState<Category>('System and alerts')
  const [workspaceName, setWorkspaceName] = useState('Acme creator operations')
  const dirty = workspaceName !== 'Acme creator operations'

  return (
    <SettingsPage width="full" className="bakin-settings-dashboard-story">
      <PageHeader
        eyebrow="Workspace / configuration"
        title="Settings"
        description="Configure system behavior and installed extensions without losing which category is active. Routed pages keep the category in query state."
      />

      <SettingsPageBody layout="navigation">
        <SettingsPageNavigation label="Settings categories">
          <p className="bakin-settings-dashboard-story__navigation-label">Workspace</p>
          {categories.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={category === item ? 'secondary' : 'ghost'}
              aria-current={category === item ? 'page' : undefined}
              onClick={() => setCategory(item)}
            >
              {item}
            </Button>
          ))}
        </SettingsPageNavigation>

        <SettingsPageContent
          labelledBy="active-settings-heading"
          feedback={dirty ? (
            <Banner
              tone="attention"
              headingLevel={3}
              title="Unsaved changes"
              description="Review and save this category before navigating away. The routed implementation supplies the navigation guard."
            />
          ) : undefined}
        >
          <Stack gap="dense">
            <h2 id="active-settings-heading">{category}</h2>
            <p className="bakin-settings-dashboard-story__section-description">
              {category === 'System and alerts'
                ? 'Defaults shared by the host and every official plugin.'
                : 'This category proves the navigation frame without moving category ownership into the recipe.'}
            </p>
          </Stack>

          {category === 'System and alerts' ? (
            <Form aria-label="System and alerts settings">
              <Section spacing="compact" aria-labelledby="workspace-identity-heading">
                <Stack gap="dense">
                  <h3 id="workspace-identity-heading">Workspace identity</h3>
                  <p className="bakin-settings-dashboard-story__section-description">Stable identity and operational defaults use the canonical field contract.</p>
                </Stack>
                <Field name="workspaceName">
                  <FieldLabel requirement="required">Workspace name</FieldLabel>
                  <FieldDescription>Shown in navigation and plugin-contributed page chrome.</FieldDescription>
                  <Input
                    required
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.currentTarget.value)}
                  />
                </Field>
              </Section>

              <Section spacing="compact" divider="top" aria-labelledby="notification-heading">
                <Stack gap="dense">
                  <h3 id="notification-heading">Operational notifications</h3>
                  <p className="bakin-settings-dashboard-story__section-description">Settings that affect every plugin remain explicit and readable.</p>
                </Stack>
                <Field orientation="horizontal" name="degradedAlerts">
                  <Switch defaultChecked />
                  <FieldLabel>Notify when an official integration degrades</FieldLabel>
                  <FieldDescription>Alerts include the affected plugin and a supported recovery path.</FieldDescription>
                </Field>
              </Section>

              <FormActions align="between">
                <p className="bakin-settings-dashboard-story__save-status" role="status">
                  {dirty ? 'Unsaved changes' : 'No pending changes'}
                </p>
                <div className="bakin-settings-dashboard-story__form-buttons">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!dirty}
                    onClick={() => setWorkspaceName('Acme creator operations')}
                  >
                    Discard
                  </Button>
                  <SubmitButton disabled={!dirty}>Save settings</SubmitButton>
                </div>
              </FormActions>
            </Form>
          ) : (
            <SystemState
              kind="initial-empty"
              title={`${category} are not configured`}
              description="Connect or install the first supported provider for this workspace."
              action={<Button>Configure category</Button>}
            />
          )}
        </SettingsPageContent>
      </SettingsPageBody>
    </SettingsPage>
  )
}

export const SettingsCategories = {
  render: () => <SettingsCategoriesExample />,
  play: async ({ canvas, userEvent }) => {
    const extensions = canvas.getByRole('button', { name: 'Extensions' })
    await userEvent.click(extensions)
    await expect(extensions).toHaveAttribute('aria-current', 'page')
    await expect(canvas.getByRole('heading', { level: 2, name: 'Extensions' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'System and alerts' }))
    const name = canvas.getByRole('textbox', { name: 'Workspace name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Acme operations')
    await expect(canvas.getByRole('button', { name: 'Save settings' })).toBeEnabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }))
  },
} satisfies Story

export const SettingsUnavailable = {
  render: () => (
    <SettingsPage className="bakin-settings-dashboard-story">
      <PageHeader
        eyebrow="Workspace / configuration"
        title="Settings"
        description="Page identity and category navigation stay available when one settings provider cannot load."
      />
      <SettingsPageBody layout="navigation">
        <SettingsPageNavigation label="Settings categories">
          <Button size="sm" variant="secondary" aria-current="page">Integrations and keys</Button>
          <Button size="sm" variant="ghost">Official plugins</Button>
        </SettingsPageNavigation>
        <SettingsPageContent
          label="Integrations and keys settings"
          state={(
            <SystemState
              kind="error"
              title="Integration settings could not be loaded"
              description="The current provider did not respond. Other settings categories remain available."
              action={<Button variant="outline">Try again</Button>}
            />
          )}
        />
      </SettingsPageBody>
    </SettingsPage>
  ),
} satisfies Story

const operations = [
  { label: 'Search index', detail: 'Verified 3 minutes ago', status: 'Healthy', tone: 'success' as const },
  { label: 'Provider credentials', detail: '1 key expires in 6 days', status: 'Review', tone: 'attention' as const },
  { label: 'Official plugin runtime', detail: '14 clients reporting', status: 'Healthy', tone: 'success' as const },
]

function DashboardOverviewExample() {
  const [checking, setChecking] = useState(false)

  const runChecks = () => {
    setChecking(true)
    window.setTimeout(() => setChecking(false), 120)
  }

  return (
    <DashboardPage className="bakin-settings-dashboard-story">
      <PageHeader
        eyebrow="Health / operational overview"
        title="Keep Bakin ready to work"
        description="Lead with the condition that needs a decision, then reveal supporting metrics and operational detail."
        actions={<><Button variant="outline">View activity</Button><Button disabled={checking} onClick={runChecks}>{checking ? 'Running checks…' : 'Run checks'}</Button></>}
      />

      <DashboardPageContent label="Health overview" busy={checking}>
        <section className="bakin-settings-dashboard-story__pulse" aria-labelledby="platform-pulse-heading">
          <div>
            <p className="bakin-settings-dashboard-story__kicker">Platform pulse</p>
            <h2 id="platform-pulse-heading">One provider credential needs review</h2>
            <p>Work is running normally. Rotate the Anthropic key before July 25 to avoid interrupted agent turns.</p>
          </div>
          <div className="bakin-settings-dashboard-story__pulse-action">
            <Badge tone="attention" variant="outline">Needs attention</Badge>
            <Button>Review credential</Button>
          </div>
        </section>

        <dl className="bakin-settings-dashboard-story__metrics" aria-label="Health summary metrics">
          <div><dt>Active agents</dt><dd className="bakin-settings-dashboard-story__metric-value">8</dd><dd className="bakin-settings-dashboard-story__metric-meta">2 working now</dd></div>
          <div><dt>Checks passed</dt><dd className="bakin-settings-dashboard-story__metric-value">17/18</dd><dd className="bakin-settings-dashboard-story__metric-meta">Last verified 3m ago</dd></div>
          <div><dt>Context budget</dt><dd className="bakin-settings-dashboard-story__metric-value">61%</dd><dd className="bakin-settings-dashboard-story__metric-meta">Across active sessions</dd></div>
          <div><dt>Weekly spend</dt><dd className="bakin-settings-dashboard-story__metric-value">$284</dd><dd className="bakin-settings-dashboard-story__metric-meta">8% below prior week</dd></div>
        </dl>

        <Grid layout="main-aside" gap="section" align="start">
          <Section spacing="compact" aria-labelledby="attention-heading">
            <Stack gap="dense">
              <h2 id="attention-heading">Needs attention</h2>
              <p className="bakin-settings-dashboard-story__section-description">Actionable conditions come before general telemetry.</p>
            </Stack>
            <article className="bakin-settings-dashboard-story__incident">
              <div><Badge tone="attention">Credential</Badge><h3>Anthropic API key expires soon</h3><p>Used by 3 active agents and 2 scheduled workflows.</p></div>
              <Button size="sm" variant="outline">Open settings</Button>
            </article>
          </Section>

          <Section spacing="compact" aria-labelledby="capacity-heading">
            <Stack gap="dense">
              <h2 id="capacity-heading">Current capacity</h2>
              <p className="bakin-settings-dashboard-story__section-description">Supporting context stays concise beside the primary operational decision.</p>
            </Stack>
            <dl className="bakin-settings-dashboard-story__capacity">
              <div><dt>Queue</dt><dd>4 tasks</dd></div>
              <div><dt>Oldest wait</dt><dd>36 seconds</dd></div>
              <div><dt>Available agents</dt><dd>6</dd></div>
            </dl>
          </Section>
        </Grid>

        <Section spacing="compact" divider="top" aria-labelledby="operations-heading">
          <Stack gap="dense">
            <h2 id="operations-heading">Operations</h2>
            <p className="bakin-settings-dashboard-story__section-description">Repeated operational rows use contextual density; they do not turn the whole dashboard into a compact theme.</p>
          </Stack>
          <ul className="bakin-settings-dashboard-story__operations">
            {operations.map((operation) => (
              <li key={operation.label}>
                <div><strong>{operation.label}</strong><span>{operation.detail}</span></div>
                <Badge tone={operation.tone}>{operation.status}</Badge>
                <Button size="sm" variant="ghost" aria-label={`Open ${operation.label}`}>Open</Button>
              </li>
            ))}
          </ul>
        </Section>
      </DashboardPageContent>
    </DashboardPage>
  )
}

export const DashboardOverview = {
  render: () => <DashboardOverviewExample />,
  play: async ({ canvas, userEvent }) => {
    const run = canvas.getByRole('button', { name: 'Run checks' })
    await userEvent.click(run)
    await expect(canvas.findByRole('button', { name: 'Running checks…' })).resolves.toBeDisabled()
    await expect(canvas.findByRole('button', { name: 'Run checks' })).resolves.toBeEnabled()
  },
} satisfies Story

export const DashboardUnavailable = {
  render: () => (
    <DashboardPage className="bakin-settings-dashboard-story">
      <PageHeader
        eyebrow="Runtime / overview"
        title="Runtime capabilities"
        description="The page action and identity remain available while the overview owns its failure state."
        actions={<Button variant="outline">Refresh</Button>}
      />
      <DashboardPageContent
        label="Runtime capability overview"
        state={(
          <SystemState
            kind="error"
            title="Runtime capabilities are unavailable"
            description="The active runtime did not return a capability report. Existing agents keep their current assignments."
            action={<Button variant="outline">Try again</Button>}
          />
        )}
      />
    </DashboardPage>
  ),
} satisfies Story
