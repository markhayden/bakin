/**
 * Browser (OS) notifications — host-shell plumbing. The six verbs below are
 * `@makinbakin/sdk/internal` (the host's toggle, boot-time navigator); only
 * `sendBrowserNotification` is plugin-facing, via `@makinbakin/sdk/hooks`.
 */
const STORAGE_KEY = 'bakin-notifications-enabled'

/**
 * Navigate bridge — the host registers its router here at boot so
 * notification clicks route client-side instead of full-reloading the shell.
 * globalThis-based (like __bakinBroadcast): the browser runs ONE SDK instance
 * (the vendor bundle every plugin externalizes to), but the registration must
 * survive module identity — tests import this file from source while the
 * host registers through the entrypoint, and a module-level variable would
 * be two variables.
 */
type NavigateFn = (url: string) => void

export function setNotificationNavigator(navigate: NavigateFn): void {
  ;(globalThis as { __bakinNavigate?: NavigateFn }).__bakinNavigate = navigate
}

export function navigateToUrl(url: string): void {
  const bridge = (globalThis as { __bakinNavigate?: NavigateFn }).__bakinNavigate
  if (bridge) {
    bridge(url)
    return
  }
  // No bridge registered (shell not booted) — hard navigation is the only option.
  window.location.assign(url)
}

export function isNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext
}

export function isNotificationsEnabled(): boolean {
  if (!isNotificationsSupported()) return false
  return localStorage.getItem(STORAGE_KEY) === 'true' && Notification.permission === 'granted'
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationsSupported()) return false
  const result = await Notification.requestPermission()
  const granted = result === 'granted'
  localStorage.setItem(STORAGE_KEY, String(granted))
  return granted
}

export function toggleNotifications(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled))
}

export function sendBrowserNotification(title: string, body: string, url?: string): void {
  if (!isNotificationsEnabled()) return
  if (document.hasFocus()) return
  const notification = new Notification(title, { body, icon: '/favicon.ico' })
  if (url) {
    notification.onclick = () => {
      window.focus()
      navigateToUrl(url)
      notification.close()
    }
  }
}
