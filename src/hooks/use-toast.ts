import { create } from 'zustand'
import type { ReactNode } from 'react'

const DEFAULT_DURATION: Record<Toast['type'], number> = {
  success: 4000,
  info: 4000,
  error: 10000,
}

export interface Toast {
  id: string
  message: ReactNode
  type: 'success' | 'error' | 'info'
  duration?: number
  /** Optional heading above the message (the kit Toast's title slot). */
  title?: ReactNode
  /** Optional action row (the kit Toast's action slot). */
  action?: ReactNode
  /**
   * Stays until dismissed — no timer. For attention the operator must act
   * on (the spend ladder's 90% and cap toasts); a caller that needs to know
   * WHEN it was closed subscribes to the store and watches its id go.
   */
  persistent?: boolean
}

interface ToastStore {
  toasts: Toast[]
  add: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
}

let counter = 0

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = String(++counter)
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    if (!toast.persistent) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, toast.duration ?? DEFAULT_DURATION[toast.type])
    }
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Convenience: call from anywhere without hooks. Returns the toast id for programmatic dismiss. */
export function toast(message: ReactNode, type: Toast['type'] = 'info', duration?: number): string {
  return useToastStore.getState().add({ message, type, ...(duration ? { duration } : {}) })
}
