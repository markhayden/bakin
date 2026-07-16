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
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, toast.duration ?? DEFAULT_DURATION[toast.type])
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Convenience: call from anywhere without hooks. Returns the toast id for programmatic dismiss. */
export function toast(message: ReactNode, type: Toast['type'] = 'info', duration?: number): string {
  return useToastStore.getState().add({ message, type, ...(duration ? { duration } : {}) })
}
