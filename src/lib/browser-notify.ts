const STORAGE_KEY = 'bakin-notifications-enabled'

/**
 * Navigate bridge — the host registers its router here at boot so
 * notification clicks route client-side instead of full-reloading the shell.
 * globalThis-based (like __bakinBroadcast) because every plugin bundle
 * inlines its own copy of this module; a module-level variable would never
 * reach those copies.
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
