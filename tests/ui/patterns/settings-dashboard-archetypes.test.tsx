// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  DashboardPage,
  DashboardPageContent,
  PageHeader,
  SettingsPage,
  SettingsPageBody,
  SettingsPageContent,
  SettingsPageNavigation,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('settings/form page recipe', () => {
  it('keeps named settings navigation beside a state-aware form region', () => {
    const { container } = render(
      <SettingsPage id="workspace-settings">
        <PageHeader title="Settings" description="Configure workspace behavior." />
        <SettingsPageBody layout="navigation">
          <SettingsPageNavigation label="Settings categories">
            <Button aria-current="page">System and alerts</Button>
          </SettingsPageNavigation>
          <SettingsPageContent
            label="System and alerts settings"
            busy
            feedback={<p>Unsaved changes</p>}
          >
            <form aria-label="System and alerts form">Settings fields</form>
          </SettingsPageContent>
        </SettingsPageBody>
      </SettingsPage>,
    )

    const page = container.querySelector('[data-archetype="settings"]')
    expect(page?.id).toBe('workspace-settings')
    expect(page?.getAttribute('data-width')).toBe('wide')
    expect(screen.getByRole('navigation', { name: 'Settings categories' })).toBeTruthy()
    const content = screen.getByRole('region', { name: 'System and alerts settings' })
    expect(content.getAttribute('aria-busy')).toBe('true')
    expect(content.querySelector('[data-slot="settings-page-feedback"]')?.textContent).toBe('Unsaved changes')
    expect(content.textContent).toContain('Settings fields')
    expect(container.querySelector('[data-slot="settings-page-grid"]')?.getAttribute('data-layout')).toBe('navigation')
  })

  it('replaces only the active settings content while preserving page identity and navigation', () => {
    render(
      <SettingsPage>
        <PageHeader title="Settings" />
        <SettingsPageBody layout="navigation">
          <SettingsPageNavigation label="Settings categories">System and alerts</SettingsPageNavigation>
          <SettingsPageContent
            label="System and alerts settings"
            state={<SystemState kind="permission-denied" />}
          >
            Restricted fields
          </SettingsPageContent>
        </SettingsPageBody>
      </SettingsPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Settings categories' })).toBeTruthy()
    expect(screen.getByText('Access restricted')).toBeTruthy()
    expect(screen.queryByText('Restricted fields')).toBeNull()
  })
})

describe('dashboard/overview page recipe', () => {
  it('owns a wide named overview canvas without prescribing domain sections', () => {
    const { container } = render(
      <DashboardPage id="health-overview">
        <PageHeader title="Health" actions={<Button>Run checks</Button>} />
        <DashboardPageContent
          label="Health overview"
          busy
          feedback={<p>Showing the last verified snapshot</p>}
        >
          <section aria-label="Platform pulse">Operational summary</section>
          <section aria-label="Needs attention">Incidents</section>
        </DashboardPageContent>
      </DashboardPage>,
    )

    const page = container.querySelector('[data-archetype="dashboard"]')
    expect(page?.id).toBe('health-overview')
    expect(page?.getAttribute('data-width')).toBe('wide')
    const overview = screen.getByRole('region', { name: 'Health overview' })
    expect(overview.getAttribute('aria-busy')).toBe('true')
    expect(overview.querySelector('[data-slot="dashboard-page-feedback"]')?.textContent).toContain('last verified')
    expect(screen.getByRole('region', { name: 'Platform pulse' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeTruthy()
    expect(container.querySelectorAll('main')).toHaveLength(0)
  })

  it('replaces the overview while keeping the page header and recovery action available', () => {
    render(
      <DashboardPage width="full">
        <PageHeader title="Runtime overview" />
        <DashboardPageContent
          label="Runtime overview data"
          state={<SystemState kind="error" recovery="unavailable" />}
        >
          Stale capability data
        </DashboardPageContent>
      </DashboardPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Runtime overview' })).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.queryByText('Stale capability data')).toBeNull()
  })
})
