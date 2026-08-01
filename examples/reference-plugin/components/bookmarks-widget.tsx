import { Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SystemState,
  buttonVariants,
} from '@makinbakin/sdk/ui'
import { useBookmarks } from './use-bookmarks'

/** Small `home-widget` contribution that shares the page's real data contract. */
export function BookmarksWidget() {
  const { data, loading, error, refresh } = useBookmarks()
  const bookmarks = data?.bookmarks ?? []
  const latest = bookmarks[0]

  return (
    <Card className="reference-bookmarks-widget" size="sm">
      <CardHeader>
        <CardTitle>Bookmarks</CardTitle>
        <CardDescription>Links saved by people and agents.</CardDescription>
        <CardAction><Badge size="xs" variant="outline">{bookmarks.length}</Badge></CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <SystemState
            action={<Button size="xs" type="button" variant="outline" onClick={refresh}>Retry</Button>}
            description={error}
            headingLevel={3}
            kind="error"
            recovery="available"
            scope="inline"
            title="Bookmarks unavailable"
          />
        ) : loading && data === null ? (
          <SystemState headingLevel={3} kind="loading" scope="inline" title="Loading bookmarks" />
        ) : (
          <Stack gap="dense">
            <p>{latest ? `Most recently saved: ${latest.title}` : 'No bookmarks saved yet.'}</p>
            <PluginLink
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              to="/reference-bookmarks"
            >
              Open bookmarks
            </PluginLink>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
