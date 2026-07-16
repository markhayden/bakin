/**
 * Client entry for the Bakin host. Mounts the React root with the
 * TanStack Router provider at #root.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { toNavigationOptions } from '@makinbakin/sdk/hooks'
import { router } from './router'
import { registerShellReact } from './lib/react-identity'
import { setNotificationNavigator } from '@/lib/browser-notify'

// Register the shell's React instance for plugin-load-time identity checks
// (Phase F uses `assertReactInstance` on every dynamically loaded plugin).
registerShellReact()

// OS-notification clicks route client-side through this bridge; without it
// browser-notify falls back to a full page load.
setNotificationNavigator((url) => {
  void router.navigate(toNavigationOptions(url) as never)
})

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
