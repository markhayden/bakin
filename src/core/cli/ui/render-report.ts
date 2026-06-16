import type { ComponentType } from 'react'

/**
 * Render one CLI report component to stdout. The single generic replacement for
 * the ~41 byte-identical `printXxxTui` wrappers — `loadModule` lazily imports the
 * UI module (readonly barrel / onboarding / doctor-repair), `pick` selects the
 * report from it, and `props` are its props (type-inferred from the component).
 *
 * react / ink / the UI module are imported lazily inside the function so a static
 * import of this helper stays cheap and never pulls them into the binary entry's
 * import graph.
 */
export async function renderInkReport<M, P>(
  loadModule: () => Promise<M>,
  pick: (mod: M) => ComponentType<P>,
  props: P,
): Promise<void> {
  const [mod, { renderToString }, react] = await Promise.all([
    loadModule(),
    import('./render-to-string'),
    import('react'),
  ])
  // createElement's overloads don't resolve cleanly against a generic ComponentType<P>;
  // the public signature above keeps every caller fully type-checked, so a contained cast
  // to the precise (component, props) signature here is safe and leaks nothing.
  const createElement = react.createElement as (type: ComponentType<P>, props: P) => ReturnType<typeof react.createElement>
  console.log(renderToString(createElement(pick(mod), props)))
}
