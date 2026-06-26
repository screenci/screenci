import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { spawn } from 'child_process'
import { openUrlInBrowser, resolveBrowserOpenSpec } from './openBrowser.js'

const URL = 'https://app.screenci.com/cli-auth?session=token-123'

function makeChild(): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { unref: vi.fn() })
}

describe('resolveBrowserOpenSpec', () => {
  it('uses `open` on macOS', () => {
    expect(resolveBrowserOpenSpec(URL, 'darwin')).toEqual({
      command: 'open',
      args: [URL],
    })
  })

  it('uses `cmd /c start` with an empty title on Windows', () => {
    expect(resolveBrowserOpenSpec(URL, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', URL],
    })
  })

  it('uses `xdg-open` on Linux and other platforms', () => {
    expect(resolveBrowserOpenSpec(URL, 'linux')).toEqual({
      command: 'xdg-open',
      args: [URL],
    })
    expect(resolveBrowserOpenSpec(URL, 'freebsd')).toEqual({
      command: 'xdg-open',
      args: [URL],
    })
  })
})

describe('openUrlInBrowser', () => {
  it('dispatches a detached launch and reports success', async () => {
    const child = makeChild()
    const spawnFn = vi.fn().mockReturnValue(child)

    const result = await openUrlInBrowser(URL, {
      platform: 'linux',
      spawnFn: spawnFn as unknown as typeof spawn,
    })

    expect(result).toEqual({ opened: true })
    expect(spawnFn).toHaveBeenCalledWith(
      'xdg-open',
      [URL],
      expect.objectContaining({ stdio: 'ignore', detached: true })
    )
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('reports failure when the launch errors asynchronously (e.g. opener missing)', async () => {
    const child = makeChild()
    const spawnFn = vi.fn().mockImplementation(() => {
      // ENOENT surfaces on the next tick, after the error listener is attached.
      process.nextTick(() =>
        child.emit('error', new Error('spawn xdg-open ENOENT'))
      )
      return child
    })

    const result = await openUrlInBrowser(URL, {
      platform: 'linux',
      spawnFn: spawnFn as unknown as typeof spawn,
    })

    expect(result).toEqual({
      opened: false,
      reason: 'spawn xdg-open ENOENT',
    })
  })

  it('reports failure when spawn throws synchronously', async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      throw new Error('EACCES')
    })

    const result = await openUrlInBrowser(URL, {
      platform: 'darwin',
      spawnFn: spawnFn as unknown as typeof spawn,
    })

    expect(result).toEqual({ opened: false, reason: 'EACCES' })
  })
})
