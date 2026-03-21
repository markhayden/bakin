import { describe, it, expect, vi } from 'vitest'
import { MCEventBus } from '../../src/lib/events/event-bus'

describe('EventBus', () => {
  it('emit calls broadcast with data', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    bus.emit('test.event', { key: 'value' })

    expect(broadcast).toHaveBeenCalledOnce()
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      type: 'plugin-event',
      event: 'test.event',
      key: 'value',
    })
  })

  it('on() subscribes to exact events', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const handler = vi.fn()

    bus.on('task.created', handler)
    bus.emit('task.created', { id: '1' })
    bus.emit('task.moved', { id: '2' })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('task.created', { id: '1' })
  })

  it('on() with glob matches prefix', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const handler = vi.fn()

    bus.on('task.*', handler)
    bus.emit('task.created', { id: '1' })
    bus.emit('task.moved', { id: '2' })
    bus.emit('calendar.updated', { id: '3' })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('once() fires handler only once', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const handler = vi.fn()

    bus.once('task.done', handler)
    bus.emit('task.done', {})
    bus.emit('task.done', {})

    expect(handler).toHaveBeenCalledOnce()
  })

  it('unsubscribe function removes handler', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const handler = vi.fn()

    const unsub = bus.on('test', handler)
    bus.emit('test', {})
    expect(handler).toHaveBeenCalledOnce()

    unsub()
    bus.emit('test', {})
    expect(handler).toHaveBeenCalledOnce() // no additional call
  })

  it('handler errors do not break other handlers', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const bad = vi.fn(() => { throw new Error('bad handler') })
    const good = vi.fn()

    bus.on('test', bad)
    bus.on('test', good)
    bus.emit('test', {})

    expect(bad).toHaveBeenCalledOnce()
    expect(good).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('injectFileEvent notifies local subscribers', () => {
    const broadcast = vi.fn()
    const bus = new MCEventBus(broadcast)
    const handler = vi.fn()

    bus.on('file.change', handler)
    bus.injectFileEvent('TASKBOARD.md', 'change', 'content here')

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][1]).toMatchObject({
      file: 'TASKBOARD.md',
      event: 'change',
      content: 'content here',
    })
    // injectFileEvent should NOT broadcast to SSE
    expect(broadcast).not.toHaveBeenCalled()
  })
})
