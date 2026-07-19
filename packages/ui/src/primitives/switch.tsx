import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { mergeClassName } from '../utils'

export type SwitchSize = 'sm' | 'default'
export type SwitchProps = SwitchPrimitive.Root.Props & { size?: SwitchSize }

const switchClasses = [
  'group/switch relative inline-flex h-bakin-6 shrink-0 cursor-pointer items-center rounded-bakin-pill border border-bakin-border-subtle p-[2px] outline-none select-none',
  'transition-[background-color,border-color,opacity] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'data-[size=default]:w-10 data-[size=sm]:w-bakin-8',
  'data-checked:border-bakin-action-primary-background data-checked:bg-bakin-action-primary-background',
  'data-unchecked:bg-bakin-border-subtle/60',
  'aria-invalid:border-bakin-signal-danger',
  'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'data-readonly:cursor-default',
  'motion-reduce:transition-none',
].join(' ')

const switchThumbClasses = [
  'pointer-events-none block shrink-0 rounded-bakin-pill bg-bakin-action-primary-foreground shadow-sm',
  'transition-transform duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'group-data-[size=default]/switch:size-[calc(var(--bakin-layout-space-6)-var(--bakin-layout-space-1))]',
  'group-data-[size=sm]/switch:size-bakin-4',
  'group-data-[size=default]/switch:data-checked:translate-x-bakin-4',
  'group-data-[size=sm]/switch:data-checked:translate-x-bakin-3',
  'data-unchecked:translate-x-0 motion-reduce:transition-none',
].join(' ')

export function Switch({ className, size = 'default', ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={mergeClassName(switchClasses, className)}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={switchThumbClasses} />
    </SwitchPrimitive.Root>
  )
}
