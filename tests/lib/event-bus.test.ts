import { describe, it, expect, mock, spyOn } from 'bun:test'
import { BakinEventBus } from '../../src/lib/events/event-bus'

describe('EventBus', () => {
  it('emit calls broadcast with data', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    bus.emit('test.event', { key: 'value' })

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      type: 'plugin-event',
      event: 'test.event',
      key: 'value',
    })
  })

  it('on() subscribes to exact events', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const handler = mock()

    bus.on('task.created', handler)
    bus.emit('task.created', { id: '1' })
    bus.emit('task.moved', { id: '2' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('task.created', { id: '1' })
  })

  it('on() with glob matches prefix', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const handler = mock()

    bus.on('task.*', handler)
    bus.emit('task.created', { id: '1' })
    bus.emit('task.moved', { id: '2' })
    bus.emit('calendar.updated', { id: '3' })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('once() fires handler only once', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const handler = mock()

    bus.once('task.done', handler)
    bus.emit('task.done', {})
    bus.emit('task.done', {})

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe function removes handler', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const handler = mock()

    const unsub = bus.on('test', handler)
    bus.emit('test', {})
    expect(handler).toHaveBeenCalledTimes(1)

    unsub()
    bus.emit('test', {})
    expect(handler).toHaveBeenCalledTimes(1) // no additional call
  })

  it('handler errors do not break other handlers', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    const bad = mock(() => { throw new Error('bad handler') })
    const good = mock()

    bus.on('test', bad)
    bus.on('test', good)
    bus.emit('test', {})

    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('injectFileEvent notifies local subscribers', () => {
    const broadcast = mock()
    const bus = new BakinEventBus(broadcast)
    const handler = mock()

    bus.on('file.change', handler)
    bus.injectFileEvent('MEMORY-LOG.md', 'change', 'content here')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][1]).toMatchObject({
      file: 'MEMORY-LOG.md',
      event: 'change',
      content: 'content here',
    })
    // injectFileEvent should NOT broadcast to SSE
    expect(broadcast).not.toHaveBeenCalled()
  })
})
