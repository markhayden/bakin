import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Separator,
  Skeleton,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Surface and content',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Canonical Product Character overview for bounded objects, identity, separation, loading presentation, and disclosure.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Foundation</p>
        <h1>Surface and content</h1>
        <p>Use hierarchy and whitespace for pages. Add a Card only when the object itself has a meaningful boundary.</p>
      </header>

      <section className="bakin-primitive-story__section" aria-labelledby="surface-heading">
        <header><h2 id="surface-heading">A genuinely bounded object</h2><p>A persistent workflow has identity, state, ownership, and a local action.</p></header>
        <Card aria-labelledby="launch-title">
          <CardHeader>
            <CardTitle id="launch-title">Launch review workflow</CardTitle>
            <CardDescription>Coordinates approvals for the Q3 product launch.</CardDescription>
            <CardAction><span className="bakin-primitive-story__status">Running</span></CardAction>
          </CardHeader>
          <CardContent>
            <AvatarGroup role="group" aria-label="Three assigned agents">
              <Avatar><AvatarFallback>AM</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>JL</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>SK</AvatarFallback><AvatarBadge role="img" aria-label="Available" /></Avatar>
              <AvatarGroupCount aria-label="Two more agents">+2</AvatarGroupCount>
            </AvatarGroup>
          </CardContent>
          <CardFooter><span className="bakin-primitive-story__status">Updated 8 minutes ago</span></CardFooter>
        </Card>
      </section>

      <section className="bakin-primitive-story__section" aria-labelledby="structure-heading">
        <header><h2 id="structure-heading">Content structure</h2><p>Separators reinforce a real boundary; they do not replace headings or spacing.</p></header>
        <div className="bakin-primitive-story__stack">
          <p>Runtime policy</p>
          <Separator decorative={false} />
          <Collapsible>
            <CollapsibleTrigger>Advanced retry policy <span aria-hidden="true">+</span></CollapsibleTrigger>
            <CollapsibleContent>Retry failed dispatches twice with exponential backoff.</CollapsibleContent>
          </Collapsible>
        </div>
      </section>

      <section className="bakin-primitive-story__section" aria-labelledby="loading-heading" aria-busy="true">
        <header><h2 id="loading-heading">Loading presentation</h2><p>The labelled container communicates loading; Skeleton remains silent.</p></header>
        <div className="bakin-primitive-story__loading-object">
          <Skeleton shape="circle" className="bakin-primitive-story__loading-avatar" />
          <div className="bakin-primitive-story__stack">
            <Skeleton shape="text" className="bakin-primitive-story__loading-line bakin-primitive-story__loading-line--medium" />
            <Skeleton shape="text" className="bakin-primitive-story__loading-line" />
          </div>
        </div>
      </section>
    </main>
  ),
} satisfies Story
