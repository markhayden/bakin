// Explicit named re-exports for React. Bun's CJS→ESM interop emits only a
// default export when bundling react's index.js directly, which breaks
// `import { useState } from 'react'` at runtime. Listing every name here
// forces Bun to preserve them on the output bundle.
//
// This list must mirror every `exports.<name>` in React's CJS entry
// (node_modules/.../react/cjs/react.development.js). Missing entries break
// downstream consumers silently — notably react-dom reads
// `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` off
// React to wire the dispatcher, and without it you get "Cannot read
// properties of undefined (reading 'S')" at render time.
import React from 'react'

export const {
  // React 19 internals — don't drop these.
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  // Components, classes, elements.
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  // Runtime + test utilities.
  act,
  cache,
  cacheSignal,
  captureOwnerStack,
  startTransition,
  use,
  unstable_useCacheRefresh,
  version,
  // Hooks.
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} = React

export default React
