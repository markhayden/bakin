import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * `useState` whose value resets to `initial()` whenever `key` changes — the
 * React-documented way to adjust state when a prop changes (state is set
 * during render, never from an effect, so the reset lands in the same pass
 * as the prop and nothing paints a stale frame). Use it where a component
 * keeps local state "per thing" (a draft per conversation, a typed
 * confirmation per dialog opening, a snapshot per id) and would otherwise
 * re-seed that state from a `useEffect` (#966b).
 */
export function useKeyedState<T>(key: unknown, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [slot, setSlot] = useState<{ key: unknown; value: T }>(() => ({ key, value: initial() }))
  let value = slot.value
  if (!Object.is(slot.key, key)) {
    value = initial()
    setSlot({ key, value })
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setSlot((previous) => {
      const next = typeof update === 'function' ? (update as (prev: T) => T)(previous.value) : update
      // Same value, same slot: React bails out exactly as useState would
      // (controlled libraries such as React Flow call the setter on every
      // measurement pass and rely on that).
      return Object.is(next, previous.value) ? previous : { key: previous.key, value: next }
    })
  }, [])
  return [value, setValue]
}
