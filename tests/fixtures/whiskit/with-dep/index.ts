// Fixture that declares + uses a pure-JS npm dependency (no native, no install
// scripts), exercising the `bun install` + dependency-bundling build path. The
// dep is intentionally NOT in the repo's root node_modules — Whiskit installs
// it into staging at build time — so this fixture is excluded from the app
// typecheck (see tsconfig.app.json).
import slugify from '@sindresorhus/slugify'

interface PluginLike {
  id: string
  name: string
  version: string
  activate: () => void
}

const plugin: PluginLike = {
  id: 'whiskit-with-dep',
  name: 'Whiskit With Dependency',
  version: '0.1.0',
  activate() {
    // Reference the dep so the bundler must resolve + include it.
    void slugify('Whiskit With Dep')
  },
}

export default plugin
