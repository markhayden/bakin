import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Command, CommandGroup, CommandInput, CommandItem, CommandList, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Anchored overlays',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Popover, DropdownMenu, Tooltip, and Command share one collision-safe layer and option-list language while keeping distinct semantics. Use the smallest surface that matches the interaction.' } },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Anchored layers</p><h1>Context without disorientation</h1><p>Choose by interaction model, then inherit the same spacing, focus, collision, and portal rules.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="anchored-family-heading">
        <header><h2 id="anchored-family-heading">Canonical choices</h2><p>Every trigger remains meaningful before its layer opens.</p></header>
        <div className="bakin-primitive-story__grid">
          <article className="bakin-primitive-story__overlay-choice"><div><p className="bakin-primitive-story__eyebrow">Supporting context</p><h3>Popover</h3><p>Use for a small interactive panel related to one trigger.</p></div><Popover><PopoverTrigger render={<Button variant="outline" />}>Inspect filters</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>Active filters</PopoverTitle><PopoverDescription>Three operational states narrow this view.</PopoverDescription></PopoverHeader></PopoverContent></Popover></article>
          <article className="bakin-primitive-story__overlay-choice"><div><p className="bakin-primitive-story__eyebrow">Action set</p><h3>Dropdown menu</h3><p>Use for a compact set of actions or mutually exclusive options.</p></div><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Task actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Duplicate</DropdownMenuItem><DropdownMenuItem variant="danger">Delete task</DropdownMenuItem></DropdownMenuContent></DropdownMenu></article>
          <article className="bakin-primitive-story__overlay-choice"><div><p className="bakin-primitive-story__eyebrow">Supplemental label</p><h3>Tooltip</h3><p>Use for concise, non-essential help—not required instructions.</p></div><TooltipProvider delay={0}><Tooltip><TooltipTrigger render={<Button variant="outline" aria-label="Explain blocked state" />}>Why blocked?</TooltipTrigger><TooltipContent>Waiting for an approval.</TooltipContent></Tooltip></TooltipProvider></article>
          <article className="bakin-primitive-story__overlay-choice"><div><p className="bakin-primitive-story__eyebrow">Search and act</p><h3>Command</h3><p>Use when a growing action or entity set benefits from filtering.</p></div><div className="bakin-primitive-story__command-preview"><Command label="Find a task action"><CommandInput placeholder="Find an action…" /><CommandList><CommandGroup heading="Tasks"><CommandItem>Open details</CommandItem><CommandItem>Assign owner</CommandItem></CommandGroup></CommandList></Command></div></article>
        </div>
      </section>
    </main>
  ),
} satisfies Story
