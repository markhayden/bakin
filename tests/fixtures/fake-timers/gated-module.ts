// Fixture for tests/setup-fake-timers.test.ts: module evaluation parks on a
// gate the test controls, so the test can prove the fake-timer drain returns
// while a dynamic import() is still pending.
await (globalThis as { __fakeTimerGate?: Promise<void> }).__fakeTimerGate
export const loaded = true
