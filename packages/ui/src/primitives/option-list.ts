/** Private presentation shared by Select now and anchored option surfaces later. */
export const anchoredPositionerClasses = 'isolate z-50 outline-none'

export const anchoredPopupClasses = [
  'relative isolate max-h-(--available-height) max-w-[min(var(--available-width),28rem)] origin-(--transform-origin)',
  'overflow-x-hidden overflow-y-auto rounded-bakin-overlay border border-bakin-border-subtle',
  'bg-bakin-surface-default text-bakin-text-primary shadow-bakin-elevation-overlay outline-none',
  'transition-[opacity,transform] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
  'motion-reduce:transform-none motion-reduce:transition-none',
].join(' ')

export const optionPopupClasses = [
  anchoredPopupClasses,
  'w-(--anchor-width) min-w-48',
].join(' ')

export const optionListClasses = 'grid min-w-0 p-bakin-1'

export const optionGroupClasses = 'grid min-w-0 scroll-my-bakin-1'

export const optionGroupLabelClasses = [
  'px-bakin-2 pb-bakin-1 pt-bakin-2 font-bakin-typography-family-ui',
  'text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-[.08em] text-bakin-text-muted',
].join(' ')

export const optionItemClasses = [
  'relative flex min-h-bakin-8 w-full min-w-0 cursor-default select-none items-center gap-bakin-2 rounded-bakin-control',
  'py-bakin-2 pl-bakin-2 pr-bakin-8 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] leading-snug text-bakin-text-primary outline-none',
  'data-highlighted:bg-bakin-border-subtle/35 data-highlighted:text-bakin-text-primary',
  'data-selected:bg-bakin-action-primary-background/10',
  'data-disabled:pointer-events-none data-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0',
].join(' ')

export const optionSeparatorClasses = 'pointer-events-none mx-bakin-1 my-bakin-1 h-px bg-bakin-border-subtle'

export const optionScrollButtonClasses = [
  'sticky z-10 flex min-h-bakin-6 w-full cursor-default items-center justify-center',
  'bg-bakin-surface-default text-bakin-text-muted',
].join(' ')
