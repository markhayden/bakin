'use client'

import { useState, useEffect, createElement } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import {
  isNotificationsSupported,
  isNotificationsEnabled,
  requestNotificationPermission,
  toggleNotifications,
} from '@/lib/browser-notify'

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported(isNotificationsSupported())
    setEnabled(isNotificationsEnabled())
  }, [])

  async function handleClick() {
    if (!supported) {
      const isInsecure = typeof window !== 'undefined' && !window.isSecureContext
      toast(
        isInsecure
          ? createElement('span', null,
              'Notifications require a secure context. Access Bakin at ',
              createElement('strong', null, `localhost:${window.location.port || '3737'}`),
              ' instead of ',
              createElement('strong', null, window.location.hostname),
              ' to enable.',
            )
          : 'Your browser does not support notifications.',
        'error',
      )
      return
    }
    if (enabled) {
      toggleNotifications(false)
      setEnabled(false)
      toast('Gate notifications disabled', 'info')
    } else {
      // Check if permission was previously denied — browser won't re-prompt
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        toast(
          createElement('span', null,
            'Notifications blocked by browser. Click the ',
            createElement('strong', null, 'lock icon'),
            ' in your address bar ',
            createElement('span', null, '\u2192 Site settings \u2192 Notifications \u2192 Allow'),
          ),
          'error',
        )
        return
      }
      const granted = await requestNotificationPermission()
      if (granted) {
        toggleNotifications(true)
        setEnabled(true)
        toast('Gate notifications enabled', 'success')
        // Send a test notification so user sees it working
        new Notification('Bakin notifications enabled', {
          body: 'You\'ll be notified when a workflow gate needs approval.',
          icon: '/favicon.ico',
        })
      } else {
        toast(
          createElement('span', null,
            'Notification permission not granted. Click the ',
            createElement('strong', null, 'lock icon'),
            ' in your address bar to enable.',
          ),
          'error',
        )
      }
    }
  }

  return (
    <button
      onClick={handleClick}
      title={enabled ? 'Disable gate notifications' : 'Enable gate notifications'}
      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)]"
    >
      {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
    </button>
  )
}
