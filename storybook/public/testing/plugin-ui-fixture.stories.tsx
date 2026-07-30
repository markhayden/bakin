import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'
import { PluginLink, useSearchParams } from '@makinbakin/sdk/navigation'
import { PageHeader } from '@makinbakin/sdk/patterns'
import {
  DEFAULT_PLUGIN_UI_FIXTURE,
  PluginUiFixtureHost,
  type PluginUiFixtureRegistration,
  type PluginUiFixtureSurfaceState,
} from '@makinbakin/sdk/testing/ui'
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './plugin-ui-fixture.stories.css'

const meta = {
  title: 'Testing/Plugin UI fixture host',
  component: PluginUiFixtureHost,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The public browser fixture runs external-style page and slot registrations through the production route matcher, ownership roots, scoped portals, canonical stylesheet, and deterministic runtime—without Bakin accounts or user data. Apply the exported desktop/mobile viewport to the real browser; the host data marker records intent but cannot resize the browser.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'interaction', 'system-states', 'isolation'],
  },
} satisfies Meta<typeof PluginUiFixtureHost>

export default meta
type Story = StoryObj<typeof meta>

// Passed by value in the registration map — never rendered as story JSX.
function CanonicalFixturePage() {
  return <p>Canonical fixture page</p>
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    registrations: [{ id: 'fixture-canonical', routes: { '/fixture/canonical': CanonicalFixturePage } }],
    fixture: { ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/fixture/canonical' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Canonical fixture page')).toBeVisible())
    expect(canvasElement.querySelector('[data-bakin-plugin-fixture-host]'))
      .toHaveAttribute('data-bakin-plugin-fixture-state', 'ready')
    expect(canvas.getByText('Canonical fixture page').closest('[data-bakin-plugin]'))
      .toHaveAttribute('data-bakin-plugin', 'fixture-canonical')
  },
} satisfies Story

function AlphaPage({ itemId }: { itemId?: string }) {
  const search = useSearchParams()
  const nextItemId = itemId === '43' ? '42' : '43'
  const nextSequence = nextItemId === '43' ? '002' : '001'
  return (
    <PageShell width="content" className="bakin-plugin-fixture-story__page">
      <PageHeader
        eyebrow="Fixture Alpha / page contribution"
        title={`Item ${itemId ?? 'unknown'}`}
        description={`The routed query remains an opaque string: ${search.get('sequence') ?? 'missing'}.`}
        actions={(
          <PluginLink
            className={buttonVariants({ variant: 'primary', size: 'md' })}
            to={`/fixture/alpha/items/${nextItemId}?sequence=${nextSequence}`}
          >
            Open item {nextItemId}
          </PluginLink>
        )}
      />
      <Card>
        <CardHeader>
          <CardTitle>Registered plugin page</CardTitle>
          <CardDescription>This page uses public layout, navigation, pattern, and primitive entrypoints.</CardDescription>
        </CardHeader>
        <CardContent>
          <Popover defaultOpen>
            <PopoverTrigger render={<Button variant="outline" />}>Inspect Alpha scope</PopoverTrigger>
            <PopoverContent
              className="bakin-plugin-fixture-story__domain-overlay"
              data-plugin-fixture-overlay="fixture-alpha"
            >
              <PopoverHeader>
                <PopoverTitle>Alpha page overlay</PopoverTitle>
                <PopoverDescription>The portalled panel keeps the page contribution owner.</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>
    </PageShell>
  )
}

function AlphaToolbarSlot({ contextLabel }: { contextLabel?: string }) {
  return (
    <Inline align="center" justify="between">
      <Stack gap="dense">
        <strong>Alpha slot action</strong>
        <span className="bakin-plugin-fixture-story__muted">{contextLabel}</span>
      </Stack>
      <Badge tone="neutral">Page owner</Badge>
    </Inline>
  )
}

function BravoToolbarSlot() {
  return (
    <Inline align="center" justify="between">
      <Stack gap="dense">
        <strong>Bravo slot action</strong>
        <span className="bakin-plugin-fixture-story__muted">Independent contribution owner</span>
      </Stack>
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" />}>Inspect Bravo scope</PopoverTrigger>
        <PopoverContent
          className="bakin-plugin-fixture-story__domain-overlay"
          data-plugin-fixture-overlay="fixture-bravo"
        >
          <PopoverHeader>
            <PopoverTitle>Bravo slot overlay</PopoverTitle>
            <PopoverDescription>The slot portal does not inherit Alpha&apos;s domain value.</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </Inline>
  )
}

const registrations = [
  {
    id: 'fixture-alpha',
    routes: { '/fixture/alpha/items/[itemId]': AlphaPage },
    slots: { 'fixture-toolbar': AlphaToolbarSlot },
  },
  {
    id: 'fixture-bravo',
    slots: { 'fixture-toolbar': BravoToolbarSlot },
  },
] satisfies readonly PluginUiFixtureRegistration[]

const desktopFixture = {
  ...DEFAULT_PLUGIN_UI_FIXTURE,
  route: '/fixture/alpha/items/42?sequence=001',
  randomSeed: 'plugin-ui-public-story',
  network: [
    { path: '/api/plugin-fixture/items/42', status: 200, json: { id: '42', state: 'ready' } },
  ],
} as const

const mobileFixture = { ...desktopFixture, viewport: 'mobile' as const }
const fixtureSlots = [{
  name: 'fixture-toolbar',
  label: 'Fixture toolbar contributions',
  props: { contextLabel: 'Item 42 actions' },
}] as const

export const RegisteredPageAndSlots = {
  args: {
    registrations,
    fixture: desktopFixture,
    slots: fixtureSlots,
    className: 'bakin-plugin-fixture-story',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Item 42' })).toBeVisible())
    expect(canvas.getByText('The routed query remains an opaque string: 001.')).toBeVisible()

    const page = canvasElement.querySelector('[data-bakin-plugin-fixture-page]')
    expect(page?.querySelector('h1')?.closest('[data-bakin-plugin]'))
      .toHaveAttribute('data-bakin-plugin', 'fixture-alpha')

    const slot = canvas.getByRole('complementary', { name: 'Fixture toolbar contributions' })
    const owners = slot.querySelectorAll('[data-bakin-plugin]')
    expect(owners).toHaveLength(2)
    expect(owners[0]).toHaveAttribute('data-bakin-plugin', 'fixture-alpha')
    expect(owners[1]).toHaveAttribute('data-bakin-plugin', 'fixture-bravo')

    await waitFor(() => expect(document.querySelectorAll('[data-plugin-fixture-overlay]')).toHaveLength(2))
    const alpha = document.querySelector<HTMLElement>('[data-plugin-fixture-overlay="fixture-alpha"]')!
    const bravo = document.querySelector<HTMLElement>('[data-plugin-fixture-overlay="fixture-bravo"]')!
    expect(alpha.closest('[data-bakin-plugin-portal]')).toHaveAttribute('data-bakin-plugin', 'fixture-alpha')
    expect(bravo.closest('[data-bakin-plugin-portal]')).toHaveAttribute('data-bakin-plugin', 'fixture-bravo')
    expect(getComputedStyle(alpha).borderInlineStartColor)
      .not.toBe(getComputedStyle(bravo).borderInlineStartColor)
    expect(document.querySelector('[data-bakin-plugin-fixture-overlay-root]')?.closest('[data-bakin-plugin]'))
      .toBeNull()

    expect(canvas.getByRole('link', { name: 'Open item 43' }))
      .toHaveAttribute('href', '/fixture/alpha/items/43?sequence=002')
  },
} satisfies Story

export const MobilePageAndSlots = {
  args: {
    registrations,
    fixture: mobileFixture,
    slots: fixtureSlots,
    className: 'bakin-plugin-fixture-story',
  },
  globals: {
    viewport: { value: 'mobile', isRotated: false },
  },
} satisfies Story

const fixtureStates: PluginUiFixtureSurfaceState[] = [
  'ready',
  'initial-empty',
  'no-results',
  'loading',
  'error',
  'permission-denied',
]

function SystemStateExplorer() {
  const [surfaceState, setSurfaceState] = useState<PluginUiFixtureSurfaceState>('initial-empty')
  return (
    <div className="bakin-plugin-fixture-story__state-explorer">
      <header>
        <p className="bakin-plugin-fixture-story__eyebrow">Deterministic surface state</p>
        <h1>Exercise every canonical plugin state</h1>
      </header>
      <Inline gap="item">
        {fixtureStates.map((state) => (
          <Button
            key={state}
            size="sm"
            variant={surfaceState === state ? 'secondary' : 'outline'}
            onClick={() => setSurfaceState(state)}
          >
            {state}
          </Button>
        ))}
      </Inline>
      <PluginUiFixtureHost
        registrations={registrations}
        fixture={desktopFixture}
        surfaceState={surfaceState}
        className="bakin-plugin-fixture-story bakin-plugin-fixture-story--state"
      />
    </div>
  )
}

export const CanonicalSystemStates = {
  args: { registrations },
  render: () => <SystemStateExplorer />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    for (const state of fixtureStates) {
      await userEvent.click(canvas.getByRole('button', { name: state }))
      const host = canvasElement.querySelector('[data-bakin-plugin-fixture-host]')
      expect(host).toHaveAttribute('data-bakin-plugin-fixture-state', state)
      if (state !== 'ready') {
        expect(host?.querySelector('[data-slot="system-state"]')).toHaveAttribute('data-kind', state)
      }
    }
  },
} satisfies Story
