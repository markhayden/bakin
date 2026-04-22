/**
 * React-instance identity enforcement.
 *
 * TD4 of #147. The import map emitted at TD3 is supposed to ensure the
 * shell and every plugin (Phase F) resolve `react` to the same vendor
 * bundle — one React instance, one hook store, one StrictMode tree.
 *
 * If a plugin accidentally bundles its own React (e.g. the author forgot
 * to mark it external), hooks silently break: `useState` doesn't share
 * the renderer's internal fiber state, context providers don't propagate
 * across the boundary, etc. Catching this early — at plugin load time —
 * beats debugging dashboards that look partially dead.
 *
 * Usage: called once from `main.tsx` on boot; the plugin loader (Phase F)
 * will call `assertReactInstance(pluginName, pluginReact)` after each
 * dynamic import to verify the shared-reference invariant.
 */
import React from 'react'

declare global {
  interface Window {
    /** The shell's React instance. Every plugin must reference-equal this. */
    __bakinReact?: typeof React
  }
}

/**
 * Call once at shell boot. Stores the React instance on window for later
 * verification by plugin loads.
 */
export function registerShellReact(): void {
  if (typeof window === 'undefined') return
  if (window.__bakinReact && window.__bakinReact !== React) {
    // Shouldn't happen — the shell runs once — but guard against hot-reload
    // weirdness where the module evaluates twice.
    console.warn('[bakin] react-identity: shell React re-registered with a different instance. HMR state may be inconsistent.')
  }
  window.__bakinReact = React
}

/**
 * Call after loading a plugin module. Throws if the plugin's React !==
 * the shell's React, which means the plugin bundled its own copy and
 * hooks would be broken.
 */
export function assertReactInstance(pluginId: string, pluginReact: typeof React): void {
  if (typeof window === 'undefined') return
  const shellReact = window.__bakinReact
  if (!shellReact) {
    throw new Error(`[bakin] react-identity: assertReactInstance('${pluginId}', ...) called before shell React was registered. Call registerShellReact() in main.tsx first.`)
  }
  if (pluginReact !== shellReact) {
    throw new Error(
      `[bakin] react-identity: plugin '${pluginId}' imported a DIFFERENT React instance than the shell. ` +
      `This means the plugin's build did NOT externalize 'react' — hooks will silently break. ` +
      `Fix: mark 'react' as external in the plugin's build config so it resolves via the host import map.`,
    )
  }
}
