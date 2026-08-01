import '@makinbakin/sdk/styles.css'
import './plugin.css'

import { createRoot } from 'react-dom/client'
import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { PageHeader } from '@makinbakin/sdk/patterns'
import { PluginUiFixtureHost, type PluginUiFixtureRegistration } from '@makinbakin/sdk/testing/ui'
import { Button, Card, CardContent } from '@makinbakin/sdk/ui'

function FixturePage() {
  return (
    <PageShell width="content">
      <PageHeader
        eyebrow="Conformance fixture"
        title="Release tools"
        description="A deterministic external-style plugin surface."
      />
      <Card>
        <CardContent>
          <Stack gap="item">
            <p className="fixture-pass__summary">The canonical stylesheet is loaded exactly once.</p>
            <Button type="button">Run release check</Button>
            <Button disabled type="button">Unavailable action</Button>
            <div role="tablist" aria-label="Release views">
              <Button role="tab" aria-selected="true" tabIndex={0} type="button">Overview</Button>
              <Button role="tab" aria-selected="false" tabIndex={-1} type="button">History</Button>
            </div>
          </Stack>
        </CardContent>
      </Card>
    </PageShell>
  )
}

const registrations = [{
  id: 'fixture-pass',
  routes: { '/': FixturePage },
}] satisfies readonly PluginUiFixtureRegistration[]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost registrations={registrations} />,
)
