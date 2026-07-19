import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Merge internal styles without dropping Base UI's state-aware class callback. */
export function mergeClassName<State>(
  base: string,
  className?: string | ((state: State) => string | undefined),
): string | ((state: State) => string) {
  if (typeof className === 'function') return (state) => cn(base, className(state))
  return cn(base, className)
}
