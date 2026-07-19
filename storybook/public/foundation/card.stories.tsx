import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Card',
  component: Card,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Card is for a coherent, bounded object such as a task, agent, workflow, or grouped record. Do not wrap page sections in cards or nest bordered cards; use headings, spacing, sections, and separators for page hierarchy.' } },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const BoundedObject = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Bounded object</p>
        <h1>Card</h1>
        <p>The boundary belongs to the object—not to every region on the page.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="card-example-heading">
        <header><h2 id="card-example-heading">Persistent task</h2></header>
        <Card aria-labelledby="card-title">
          <CardHeader>
            <CardTitle id="card-title">Resolve launch blockers</CardTitle>
            <CardDescription>4 linked assets · owned by Research Ops</CardDescription>
            <CardAction><Button variant="ghost" size="sm">Open</Button></CardAction>
          </CardHeader>
          <CardContent>Two approvals are waiting and one runtime check needs attention.</CardContent>
          <CardFooter><span className="bakin-primitive-story__status">Due tomorrow at 4:00 PM</span></CardFooter>
        </Card>
      </section>
    </main>
  ),
} satisfies Story

export const ContentStress = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Content stress</p>
        <h1>Long and technical content</h1>
        <p>Bounded objects wrap long names and identifiers without creating page-level overflow.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="stress-heading">
        <header><h2 id="stress-heading">Narrow object</h2></header>
        <div className="bakin-primitive-story__narrow">
          <Card size="sm" aria-labelledby="long-card-title">
            <CardHeader>
              <CardTitle id="long-card-title">Production publishing approval for the extraordinarily-long-cross-functional-campaign-name-that-cannot-be-shortened</CardTitle>
              <CardDescription>workflow_01JZ7A7RCM8S9P2B8H4VR4MVGQ · This description intentionally spans several lines to prove that unfamiliar content remains readable.</CardDescription>
            </CardHeader>
            <CardContent>No nested card is needed: content groups rely on prose, headings, and spacing.</CardContent>
          </Card>
        </div>
      </section>
    </main>
  ),
} satisfies Story
