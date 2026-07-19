import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Avatar',
  component: Avatar,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Avatar for compact identity. Provide meaningful adjacent text; initials are the reliable fallback, not a substitute for an accessible name.' } },
  },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const SizesAndFallbacks = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Identity</p>
        <h1>Avatar</h1>
        <p>Five token-backed sizes preserve hierarchy from dense metadata through prominent identity.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="avatar-sizes-heading">
        <header><h2 id="avatar-sizes-heading">Initial fallbacks</h2></header>
        <div className="bakin-primitive-story__cluster">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
            <div className="bakin-primitive-story__example" key={size}>
              <Avatar size={size}><AvatarFallback>MB</AvatarFallback></Avatar>
              <span className="bakin-primitive-story__label">{size}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="bakin-primitive-story__section" aria-labelledby="avatar-group-heading">
        <header><h2 id="avatar-group-heading">Assigned agents</h2><p>Group overlap is compact but every identity remains named in surrounding content.</p></header>
        <AvatarGroup role="group" aria-label="Assigned to Alex, Jordan, Sam, and three more agents">
          <Avatar><AvatarFallback>AM</AvatarFallback><AvatarBadge role="img" aria-label="Available" /></Avatar>
          <Avatar><AvatarFallback>JL</AvatarFallback></Avatar>
          <Avatar><AvatarFallback>SK</AvatarFallback></Avatar>
          <AvatarGroupCount aria-hidden="true">+3</AvatarGroupCount>
        </AvatarGroup>
      </section>
    </main>
  ),
} satisfies Story
