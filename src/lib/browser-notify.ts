const STORAGE_KEY = 'beacon-notifications-enabled'

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

export function sendBrowserNotification(title: string, body: string): void {
  if (!isNotificationsEnabled()) return
  if (document.hasFocus()) return
  new Notification(title, { body, icon: '/favicon.ico' })
}
