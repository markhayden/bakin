import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'

const TEST_DIR = path.join(process.cwd(), 'test-content-storage')

describe('MarkdownStorageAdapter', () => {
  let adapter: MarkdownStorageAdapter

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
    adapter = new MarkdownStorageAdapter(TEST_DIR)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
  })

  it('write creates file and read returns content', () => {
    adapter.write('test.md', '# Hello')
    expect(adapter.read('test.md')).toBe('# Hello')
  })

  it('read returns null for missing file', () => {
    expect(adapter.read('nonexistent.md')).toBeNull()
  })

  it('write creates nested directories', () => {
    adapter.write('deep/nested/file.md', 'content')
    expect(adapter.read('deep/nested/file.md')).toBe('content')
  })

  it('append adds to existing file', () => {
    adapter.write('log.md', 'line1\n')
    adapter.append('log.md', 'line2\n')
    expect(adapter.read('log.md')).toBe('line1\nline2\n')
  })

  it('append creates file if missing', () => {
    adapter.append('new.md', 'first line\n')
    expect(adapter.read('new.md')).toBe('first line\n')
  })

  it('exists returns correct boolean', () => {
    expect(adapter.exists('nope.md')).toBe(false)
    adapter.write('yes.md', 'here')
    expect(adapter.exists('yes.md')).toBe(true)
  })

  it('readAll walks directories and returns md/json/jsonl files', () => {
    adapter.write('root.md', 'root content')
    adapter.write('sub/nested.json', '{}')
    adapter.write('sub/deep/file.jsonl', '{"a":1}')
    adapter.write('skip.txt', 'should be skipped')

    const all = adapter.readAll()
    expect(all['root.md']).toBe('root content')
    expect(all['sub/nested.json']).toBe('{}')
    expect(all['sub/deep/file.jsonl']).toBe('{"a":1}')
    expect(all['skip.txt']).toBeUndefined()
  })

  it('readAll skips dotfiles', () => {
    adapter.write('.hidden.md', 'secret')
    const all = adapter.readAll()
    expect(all['.hidden.md']).toBeUndefined()
  })
})
