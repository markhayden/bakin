/**
 * Client entry for the Bakin host. Mounts the React root with the
 * TanStack Router provider at #root.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { registerShellReact } from './lib/react-identity'

// Register the shell's React instance for plugin-load-time identity checks
// (Phase F uses `assertReactInstance` on every dynamically loaded plugin).
registerShellReact()

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
