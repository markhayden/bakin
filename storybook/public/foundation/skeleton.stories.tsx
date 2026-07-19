import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Skeleton',
  component: Skeleton,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Skeleton is silent loading presentation. Put `aria-busy="true"` and an accessible name on the region doing the loading; do not announce each placeholder.' } },
  },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const LoadingObject = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Loading</p>
        <h1>Skeleton</h1>
        <p>Match the broad shape of arriving content without producing a decorative miniature UI.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="loading-object-heading" aria-busy="true">
        <header><h2 id="loading-object-heading">Loading assigned workflow</h2></header>
        <div className="bakin-primitive-story__loading-object">
          <Skeleton shape="circle" className="bakin-primitive-story__loading-avatar bakin-primitive-story__loading-avatar--large" />
          <div className="bakin-primitive-story__stack">
            <Skeleton shape="text" className="bakin-primitive-story__loading-line bakin-primitive-story__loading-line--short" />
            <Skeleton shape="text" className="bakin-primitive-story__loading-line bakin-primitive-story__loading-line--medium" />
            <Skeleton className="bakin-primitive-story__loading-block" />
          </div>
        </div>
      </section>
    </main>
  ),
} satisfies Story
