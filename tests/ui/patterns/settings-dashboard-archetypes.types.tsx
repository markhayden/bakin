import { Grid, Section } from '@makinbakin/sdk/layout'
import {
  DashboardPage,
  DashboardPageContent,
  PageHeader,
  SettingsPage,
  SettingsPageBody,
  SettingsPageContent,
  SettingsPageNavigation,
} from '@makinbakin/sdk/patterns'
import { Form, FormActions, SubmitButton } from '@makinbakin/sdk/ui'

export function ValidSettingsRecipe() {
  return (
    <SettingsPage width="content">
      <PageHeader title="Settings" />
      <SettingsPageBody layout="single">
        <SettingsPageContent labelledBy="workspace-settings-heading">
          <h2 id="workspace-settings-heading">Workspace</h2>
          <Form>
            <FormActions><SubmitButton>Save settings</SubmitButton></FormActions>
          </Form>
        </SettingsPageContent>
      </SettingsPageBody>
    </SettingsPage>
  )
}

export function ValidFullWidthSettingsRecipe() {
  return (
    <SettingsPage width="full">
      <PageHeader title="Plugin settings" />
      <SettingsPageContent label="Plugin settings">Configuration</SettingsPageContent>
    </SettingsPage>
  )
}

export function ValidDashboardRecipe() {
  return (
    <DashboardPage width="full">
      <PageHeader title="Health" />
      <DashboardPageContent label="Health overview">
        <Grid layout="split">
          <Section>Platform pulse</Section>
          <Section>Needs attention</Section>
        </Grid>
      </DashboardPageContent>
    </DashboardPage>
  )
}

// @ts-expect-error dashboards intentionally exclude reading-width canvases
export const invalidDashboardWidth = <DashboardPage width="content">Invalid</DashboardPage>

// @ts-expect-error settings navigation must have an accessible name
export const invalidSettingsNavigation = <SettingsPageNavigation>Categories</SettingsPageNavigation>

// @ts-expect-error settings content must have an accessible name
export const invalidSettingsContent = <SettingsPageContent>Fields</SettingsPageContent>

// @ts-expect-error dashboard content must have an accessible name
export const invalidDashboardContent = <DashboardPageContent>Overview</DashboardPageContent>
