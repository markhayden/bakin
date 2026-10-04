/**
 * Ambient declaration for Base UI's test-environment switch, set on globalThis
 * by tests/setup.ts. Base UI ships the same declaration in
 * `@base-ui/react/global.d.ts`, but that file is a module nothing imports, so
 * the preload (which imports no Base UI code) would not see it.
 *
 * `var` is required: only `var` declarations attach to `typeof globalThis`.
 */
// eslint-disable-next-line no-var
declare var BASE_UI_ANIMATIONS_DISABLED: boolean
