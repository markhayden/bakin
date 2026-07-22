import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { mergeClassName } from '../utils'

export type SwitchSize = 'sm' | 'default'
export type SwitchProps = SwitchPrimitive.Root.Props & { size?: SwitchSize }

const switchClasses = [
  'group/switch relative inline-flex h-bakin-6 shrink-0 cursor-pointer items-center rounded-bakin-pill px-bakin-1 outline-none select-none',
  'transition-opacity duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
  'data-[size=default]:w-10 data-[size=sm]:w-bakin-8',
  'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  'data-readonly:cursor-default',
  'motion-reduce:transition-none',
].join(' ')

const switchTrackClasses = [
  'pointer-events-none absolute rounded-bakin-pill border transition-[background-color,border-color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'group-data-[size=default]/switch:inset-0',
  'group-data-[size=sm]/switch:inset-x-0 group-data-[size=sm]/switch:inset-y-bakin-1',
  'group-data-[unchecked]/switch:border-bakin-text-muted/60 group-data-[unchecked]/switch:bg-bakin-border-subtle/35',
  'group-data-[checked]/switch:border-bakin-action-primary-background group-data-[checked]/switch:bg-bakin-action-primary-background',
  'group-aria-invalid/switch:border-bakin-signal-danger',
  'motion-reduce:transition-none',
].join(' ')

const switchThumbClasses = [
  'pointer-events-none relative block shrink-0 rounded-bakin-pill shadow-sm',
  'transition-[background-color,transform] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'group-data-[size=default]/switch:size-bakin-4',
  'group-data-[size=sm]/switch:size-bakin-3',
  'group-data-[size=default]/switch:data-checked:translate-x-bakin-4',
  'group-data-[size=sm]/switch:data-checked:translate-x-bakin-3',
  'group-data-[unchecked]/switch:bg-bakin-text-muted group-data-[checked]/switch:bg-bakin-action-primary-foreground',
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
      <span aria-hidden="true" data-slot="switch-track" className={switchTrackClasses} />
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={switchThumbClasses} />
    </SwitchPrimitive.Root>
  )
}
