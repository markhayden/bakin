import * as React from 'react'

import { layoutClassName } from './utils'

export type LayoutGap = 'none' | 'dense' | 'item' | 'section' | 'page'
export type LayoutElement = 'div' | 'section' | 'header' | 'footer' | 'nav' | 'form' | 'ul' | 'ol'
export type StackAlign = 'stretch' | 'start' | 'center' | 'end'
export type InlineAlign = StackAlign | 'baseline'
export type InlineJustify = 'start' | 'center' | 'end' | 'between'

interface FlowOwnProps {
  gap?: LayoutGap
}

interface StackOwnProps extends FlowOwnProps {
  align?: StackAlign
}

interface InlineOwnProps extends FlowOwnProps {
  align?: InlineAlign
  justify?: InlineJustify
  wrap?: boolean
}

type PolymorphicLayoutProps<Element extends LayoutElement, OwnProps> = OwnProps
  & { as?: Element }
  & Omit<React.ComponentPropsWithRef<Element>, keyof OwnProps | 'as'>

export type StackProps<Element extends LayoutElement = 'div'> = PolymorphicLayoutProps<Element, StackOwnProps>
export type InlineProps<Element extends LayoutElement = 'div'> = PolymorphicLayoutProps<Element, InlineOwnProps>

const gapClasses: Record<LayoutGap, string> = {
  none: 'gap-bakin-0',
  dense: 'gap-bakin-2',
  item: 'gap-bakin-3',
  section: 'gap-bakin-6',
  page: 'gap-bakin-8',
}

const stackAlignClasses: Record<StackAlign, string> = {
  stretch: 'items-stretch',
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
}

const inlineAlignClasses: Record<InlineAlign, string> = {
  ...stackAlignClasses,
  baseline: 'items-baseline',
}

const inlineJustifyClasses: Record<InlineJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
}

/** One-dimensional vertical rhythm with a finite semantic spacing scale. */
export function Stack<Element extends LayoutElement = 'div'>({ as, align = 'stretch', className, gap = 'item', ...props }: StackProps<Element>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <Component
      {...props}
      data-slot="stack"
      data-align={align}
      data-gap={gap}
      className={layoutClassName('flex min-w-0 flex-col', gapClasses[gap], stackAlignClasses[align], className)}
    />
  )
}

/** Wrapping horizontal rhythm for actions, metadata, and compact peer content. */
export function Inline<Element extends LayoutElement = 'div'>({
  as,
  align = 'center',
  className,
  gap = 'item',
  justify = 'start',
  wrap = true,
  ...props
}: InlineProps<Element>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <Component
      {...props}
      data-slot="inline"
      data-align={align}
      data-gap={gap}
      data-justify={justify}
      data-wrap={wrap}
      className={layoutClassName(
        'flex min-w-0',
        gapClasses[gap],
        inlineAlignClasses[align],
        inlineJustifyClasses[justify],
        wrap ? 'flex-wrap' : 'flex-nowrap',
        className,
      )}
    />
  )
}
