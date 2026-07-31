import { useToastStore } from '@makinbakin/sdk/hooks'
import { Toast, ToastRegion } from '@makinbakin/sdk/ui'

/**
 * Shell toast host: owns placement and the portal-free fixed region while the
 * kit's ToastRegion/Toast own presentation. Lifecycle (auto-dismiss timers)
 * stays in the SDK toast store.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <ToastRegion className="fixed bottom-4 left-4 z-[100]">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.type}
          description={t.message}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </ToastRegion>
  )
}
