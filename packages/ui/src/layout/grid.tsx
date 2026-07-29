import * as React from 'react'

import type { LayoutElement, LayoutGap } from './flow'
import { layoutClassName } from './utils'

export type GridLayout = 'single' | 'split' | 'thirds' | 'quarters' | 'cards' | 'main-aside'
export type GridAlign = 'stretch' | 'start' | 'center' | 'end'

interface GridOwnProps {
  align?: GridAlign
  gap?: LayoutGap
  layout?: GridLayout
}

type GridPolymorphicProps<Element extends LayoutElement> = GridOwnProps
  & { as?: Element }
  & Omit<React.ComponentPropsWithRef<Element>, keyof GridOwnProps | 'as'>

export type GridProps<Element extends LayoutElement = 'div'> = GridPolymorphicProps<Element>

const layoutClasses: Record<GridLayout, string> = {
  single: 'grid-cols-1',
  split: 'grid-cols-1 @lg/layout-grid:grid-cols-2',
  thirds: 'grid-cols-1 @lg/layout-grid:grid-cols-2 @xl/layout-grid:grid-cols-3',
  quarters: 'grid-cols-1 @sm/layout-grid:grid-cols-2 @xl/layout-grid:grid-cols-3 @4xl/layout-grid:grid-cols-4',
  cards: '[grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]',
  'main-aside': 'grid-cols-1 @3xl/layout-grid:grid-cols-[minmax(0,1.6fr)_minmax(16rem,.8fr)]',
}

const gapClasses: Record<LayoutGap, string> = {
  none: 'gap-bakin-0',
  dense: 'gap-bakin-2',
  item: 'gap-bakin-3',
  section: 'gap-bakin-6',
  page: 'gap-bakin-8',
}

const alignClasses: Record<GridAlign, string> = {
  stretch: 'items-stretch',
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
}

/** Responsive two-dimensional recipes derived from recurring Bakin page layouts. */
export function Grid<Element extends LayoutElement = 'div'>({
  align = 'stretch',
  as,
  className,
  gap = 'item',
  layout = 'single',
  ...props
}: GridProps<Element>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <div data-slot="grid-container" className="@container/layout-grid min-w-0">
      <Component
        {...props}
        data-slot="grid"
        data-align={align}
        data-gap={gap}
        data-layout={layout}
        className={layoutClassName(
          'grid min-w-0',
          layoutClasses[layout],
          gapClasses[gap],
          alignClasses[align],
          className,
        )}
      />
    </div>
  )
}
