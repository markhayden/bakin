'use client'

import { createContext, useContext, type ReactNode } from 'react'

const ModalBusyContext = createContext(false)

export function ModalBusyProvider({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <ModalBusyContext.Provider value={busy}>{children}</ModalBusyContext.Provider>
}

export function useModalBusy(): boolean {
  return useContext(ModalBusyContext)
}

export const modalBackdropClasses = [
  'fixed inset-0 isolate z-50 bg-black/55',
  'transition-opacity duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
  'data-starting-style:opacity-0 data-ending-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm',
  'motion-reduce:transition-none',
].join(' ')

export const modalCloseButtonClasses = 'absolute right-bakin-3 top-bakin-3 z-10'

export function closeIcon(label: string) {
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-[1.75]">
        <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </>
  )
}
