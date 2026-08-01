import * as React from 'react'

import { layoutClassName } from './utils'

export type SectionElement = 'section' | 'article' | 'div'
export type SectionSpacing = 'compact' | 'default' | 'generous'
export type SectionDivider = 'none' | 'top'

interface SectionOwnProps {
  divider?: SectionDivider
  spacing?: SectionSpacing
}

type SectionPolymorphicProps<Element extends SectionElement> = SectionOwnProps
  & { as?: Element }
  & Omit<React.ComponentPropsWithRef<Element>, keyof SectionOwnProps | 'as'>

export type SectionProps<Element extends SectionElement = 'section'> = SectionPolymorphicProps<Element>

const spacingClasses: Record<SectionSpacing, string> = {
  compact: 'gap-bakin-4',
  default: 'gap-bakin-6',
  generous: 'gap-bakin-8',
}

const dividerPaddingClasses: Record<SectionSpacing, string> = {
  compact: 'pt-bakin-4',
  default: 'pt-bakin-6',
  generous: 'pt-bakin-8',
}

/** Semantic content region with predictable internal rhythm and peer separation. */
export function Section<Element extends SectionElement = 'section'>({
  as,
  className,
  divider = 'none',
  spacing = 'default',
  ...props
}: SectionProps<Element>) {
  const Component = (as ?? 'section') as React.ElementType
  return (
    <Component
      {...props}
      data-slot="section"
      data-divider={divider}
      data-spacing={spacing}
      className={layoutClassName(
        'flex min-w-0 flex-col',
        spacingClasses[spacing],
        divider === 'top' && 'border-t border-bakin-border-subtle',
        divider === 'top' && dividerPaddingClasses[spacing],
        className,
      )}
    />
  )
}
