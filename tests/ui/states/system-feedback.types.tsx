import { Button, SystemState } from '@makinbakin/sdk/ui'

export const validNoResults = <SystemState kind="no-results" action={<Button>Clear filters</Button>} />
export const validRecoverableError = <SystemState kind="error" action={<Button>Try again</Button>} />
export const validTerminalError = <SystemState kind="error" recovery="unavailable" />

// @ts-expect-error A filtered no-results state must expose a reset action.
export const invalidNoResults = <SystemState kind="no-results" />

// @ts-expect-error A recoverable error must expose a recovery action.
export const invalidRecoverableError = <SystemState kind="error" />

// @ts-expect-error A terminal error cannot render an action that implies recovery.
export const invalidTerminalError = <SystemState kind="error" recovery="unavailable" action={<Button>Try again</Button>} />
