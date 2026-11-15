/**
 * Binds conversation entity cards to the app: a card's kind resolves to its
 * declared label, icon and in-app link through the browser entity registry.
 * Mounted once, above every conversation surface, so chat and every plugin
 * brainstorm get linked cards with no wiring of their own.
 */
import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import {
  EntityKindResolverContext,
  getEntityDeclaration,
  getEntityDeclarationsVersion,
  subscribeEntityDeclarations,
  type EntityKindResolver,
} from '@makinbakin/sdk/internal'
import { PluginLink, entityHref } from '@makinbakin/sdk/navigation'
import { NavIcon } from '../components/layout/sidebar-nav-item'

export function EntityCardsProvider({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(subscribeEntityDeclarations, getEntityDeclarationsVersion, () => 0)
  const resolve = useMemo<EntityKindResolver>(() => {
    // `version` keys the memo: a replaced registry yields a new resolver, so
    // cards re-resolve when a plugin is installed, removed or reloaded.
    void version
    return (ref) => {
      const declaration = getEntityDeclaration(ref.kind)
      // An undeclared kind (its plugin is gone) renders as plain content.
      if (!declaration) return null
      const href = entityHref(ref.kind, ref.id, { params: ref.params })
      return {
        label: declaration.label,
        icon: <NavIcon name={declaration.icon} />,
        ...(href ? {
          link: <PluginLink to={href} />,
          renderLink: (children) => <PluginLink to={href} className="text-bakin-text-primary underline underline-offset-2">{children}</PluginLink>,
        } : {}),
      }
    }
  }, [version])
  return <EntityKindResolverContext value={resolve}>{children}</EntityKindResolverContext>
}
