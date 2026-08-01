export type StorybookAudience = 'maintainer' | 'public'

export function storyGlobsForAudience(audience: StorybookAudience): string[] {
  const publicStories = '../storybook/public/**/*.stories.@(ts|tsx)'
  return audience === 'public'
    ? [publicStories]
    : [publicStories, '../storybook/internal/**/*.stories.@(ts|tsx)']
}
