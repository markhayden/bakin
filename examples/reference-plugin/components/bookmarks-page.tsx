import { useState, type FormEvent } from 'react'
import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { Grid, Inline, Stack } from '@makinbakin/sdk/layout'
import { ListPage, ListPageContent, PageHeader } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  SystemState,
  buttonVariants,
} from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import type { Bookmark } from '../types'
import { PLUGIN_ID, useBookmarks } from './use-bookmarks'

/** A static replay of the shape an agent produces after calling this plugin. */
const DEMO_TURN: RuntimeChatChunk[] = [
  { type: 'status', content: 'thinking' },
  {
    type: 'tool',
    data: {
      callId: 'demo-1',
      toolName: 'bakin_exec_reference-bookmarks_save',
      phase: 'result',
      status: 'completed',
      summary: 'saved "Bun docs" (bun.sh)',
    },
  },
  { type: 'text', content: 'Saved **Bun docs** to your bookmarks under `docs`.' },
  { type: 'done' },
]

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `${fallback} (${response.status})`
}

function BookmarkCard({ bookmark, deleting, onRemove }: {
  bookmark: Bookmark
  deleting: boolean
  onRemove: (id: string) => void
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <a
            aria-label={`${bookmark.title} (opens in a new tab)`}
            className={buttonVariants({
              variant: 'link',
              size: 'sm',
              className: 'reference-bookmarks__bookmark-link',
            })}
            href={bookmark.url}
            rel="noreferrer"
            target="_blank"
          >
            {bookmark.title}
          </a>
        </CardTitle>
        <CardDescription className="reference-bookmarks__bookmark-url">
          {bookmark.url}
        </CardDescription>
        <CardAction>
          <Button
            aria-label={`Delete ${bookmark.title}`}
            disabled={deleting}
            size="xs"
            type="button"
            variant="danger"
            onClick={() => onRemove(bookmark.id)}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </CardAction>
      </CardHeader>
      {bookmark.note || bookmark.tags.length > 0 ? (
        <CardContent>
          <Stack gap="dense">
            {bookmark.note ? <p>{bookmark.note}</p> : null}
            {bookmark.tags.length > 0 ? (
              <Inline as="ul" aria-label={`Tags for ${bookmark.title}`} className="reference-bookmarks__tags" gap="dense">
                {bookmark.tags.map((tag) => (
                  <li key={tag}><Badge size="xs" variant="outline">{tag}</Badge></li>
                ))}
              </Inline>
            ) : null}
          </Stack>
        </CardContent>
      ) : null}
    </Card>
  )
}

/** Canonical plugin-owned list page: public archetypes, form recipe, and states. */
export function BookmarksPage() {
  const { data, loading, error: fetchError, refresh } = useBookmarks()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const bookmarks = data?.bookmarks ?? []

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMutationError(null)
    setSaving(true)
    try {
      const response = await pluginFetch(PLUGIN_ID, '/', {
        method: 'POST',
        body: { url: url.trim(), title: title.trim() },
      })
      if (!response.ok) {
        setMutationError(await responseError(response, 'Could not save bookmark'))
        return
      }
      setUrl('')
      setTitle('')
      refresh()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save bookmark')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setMutationError(null)
    setDeletingId(id)
    try {
      const response = await pluginFetch(PLUGIN_ID, `/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        setMutationError(await responseError(response, 'Could not delete bookmark'))
        return
      }
      refresh()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not delete bookmark')
    } finally {
      setDeletingId(null)
    }
  }

  const replacementState = fetchError ? (
    <SystemState
      action={<Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
      description={`Bakin could not load this plugin's bookmarks. ${fetchError}`}
      kind="error"
      recovery="available"
      title="Bookmarks are unavailable"
    />
  ) : loading && data === null ? (
    <SystemState kind="loading" title="Loading bookmarks" />
  ) : bookmarks.length === 0 ? (
    <SystemState
      description="Save the first link above, or ask an agent to save one with the plugin tool."
      kind="initial-empty"
      title="No bookmarks yet"
    />
  ) : undefined

  return (
    <ListPage
      className="reference-bookmarks"
      data-reference-bookmarks-ready={data !== null && !loading ? '' : undefined}
    >
      <PageHeader
        description="Save useful links for people and agents through one shared plugin data path."
        eyebrow="Reference plugin / saved links"
        meta={<Badge size="xs" variant="outline">{bookmarks.length} saved</Badge>}
        title="Bookmarks"
      />

      <Card>
        <CardHeader>
          <CardTitle>Save a bookmark</CardTitle>
          <CardDescription>The same validated creation path serves this form and the agent exec tool.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form aria-label="Save a bookmark" busy={saving} onSubmit={add}>
            <Grid gap="section" layout="split">
              <Field name="url">
                <FieldLabel requirement="required">URL</FieldLabel>
                <FieldDescription>Use the complete address, including https://.</FieldDescription>
                <Input
                  required
                  autoComplete="url"
                  placeholder="https://example.com"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
              </Field>
              <Field name="title">
                <FieldLabel requirement="required">Title</FieldLabel>
                <FieldDescription>Use a short name people can recognize at a glance.</FieldDescription>
                <Input
                  required
                  placeholder="Release checklist"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </Field>
            </Grid>
            <FormActions>
              <SubmitButton
                busyLabel="Saving bookmark…"
                disabled={!url.trim() || !title.trim()}
              >
                Save bookmark
              </SubmitButton>
            </FormActions>
          </Form>
        </CardContent>
      </Card>

      <ListPageContent
        busy={loading && data !== null}
        feedback={mutationError ? (
          <Alert tone="danger">
            <AlertTitle>Bookmark change failed</AlertTitle>
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : undefined}
        label="Saved bookmarks"
        state={replacementState}
      >
        <Grid as="ul" aria-label="Saved bookmarks" className="reference-bookmarks__list" gap="item" layout="cards">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <BookmarkCard
                bookmark={bookmark}
                deleting={deletingId === bookmark.id}
                onRemove={(id) => void remove(id)}
              />
            </li>
          ))}
        </Grid>
      </ListPageContent>

      <Collapsible>
        <CollapsibleTrigger>
          Agent-facing output example <span aria-hidden="true">+</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <TurnOutputView chunks={DEMO_TURN} />
        </CollapsibleContent>
      </Collapsible>
    </ListPage>
  )
}
