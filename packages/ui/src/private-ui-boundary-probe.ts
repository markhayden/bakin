import { createElement, type ReactElement, type ReactNode } from 'react'

export interface PrivateUiBoundaryProbeProps {
  children?: ReactNode
}

/**
 * Minimal implementation used only to prove host/SDK package identity before
 * component migrations begin. It intentionally imports no runtime CSS.
 */
export function PrivateUiBoundaryProbe({ children }: PrivateUiBoundaryProbeProps): ReactElement {
  return createElement('span', { 'data-bakin-ui-boundary': 'private' }, children)
}
