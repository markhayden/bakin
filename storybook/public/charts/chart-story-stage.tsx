import { PageShell, Stack } from '@makinbakin/sdk/layout'

import './chart-foundation.stories.css'

export function ChartStage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="bakin-chart-story">
      <PageShell width="wide">
        <Stack gap="section">
          <header className="bakin-chart-story__intro">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}
