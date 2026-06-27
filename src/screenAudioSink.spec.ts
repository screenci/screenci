import { describe, it, expect, vi } from 'vitest'
import {
  assertScreenAudioCaptureReady,
  createNullSink,
  unloadNullSink,
  workerSinkName,
  type SinkDeps,
} from './screenAudioSink.js'

describe('assertScreenAudioCaptureReady', () => {
  it('resolves when pactl is present and a server is reachable', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'pactl 15.0\n' })
    await expect(
      assertScreenAudioCaptureReady({ run })
    ).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledWith('pactl', ['--version'])
    expect(run).toHaveBeenCalledWith('pactl', ['info'])
  })

  it('does not require the pulseaudio daemon binary', async () => {
    // PipeWire systems have pactl + a server but no `pulseaudio` binary; capture
    // works there, so the probe must never invoke `pulseaudio`.
    const run = vi.fn().mockResolvedValue({ stdout: 'ok' })
    await assertScreenAudioCaptureReady({ run })
    expect(run).not.toHaveBeenCalledWith('pulseaudio', expect.anything())
  })

  it('throws when pactl is not installed', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('spawn pactl ENOENT'))
    await expect(assertScreenAudioCaptureReady({ run })).rejects.toThrow(
      /"pactl" is not installed/
    )
  })

  it('throws when no pulse server is reachable', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'pactl 15.0\n' }) // --version succeeds
      .mockRejectedValueOnce(new Error('Connection refused')) // info fails
    await expect(assertScreenAudioCaptureReady({ run })).rejects.toThrow(
      /no PulseAudio\/PipeWire server is reachable/
    )
  })
})

describe('workerSinkName', () => {
  it('derives a per-process sink name from the pid', () => {
    expect(workerSinkName(123)).toBe('screenci_123')
  })
})

describe('createNullSink', () => {
  it('loads a null sink and parses the module id', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '42\n' })
    const deps: SinkDeps = { run }

    const sink = await createNullSink('screenci_42', deps)

    expect(sink).toEqual({
      moduleId: '42',
      sinkName: 'screenci_42',
      monitorSource: 'screenci_42.monitor',
    })
    expect(run).toHaveBeenCalledWith('pactl', [
      'load-module',
      'module-null-sink',
      'sink_name=screenci_42',
      'sink_properties=device.description=screenci_42',
    ])
  })

  it('returns null when pactl output is not a module id', async () => {
    const deps: SinkDeps = {
      run: vi.fn().mockResolvedValue({ stdout: 'Failure: Module load failed' }),
    }

    expect(await createNullSink('s', deps)).toBeNull()
  })

  it('returns null when pactl is missing or fails', async () => {
    const deps: SinkDeps = {
      run: vi.fn().mockRejectedValue(new Error('spawn pactl ENOENT')),
    }

    expect(await createNullSink('s', deps)).toBeNull()
  })
})

describe('unloadNullSink', () => {
  it('unloads by module id', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '' })

    await unloadNullSink(
      { moduleId: '7', sinkName: 's', monitorSource: 's.monitor' },
      { run }
    )

    expect(run).toHaveBeenCalledWith('pactl', ['unload-module', '7'])
  })

  it('never throws when unloading fails', async () => {
    const deps: SinkDeps = {
      run: vi.fn().mockRejectedValue(new Error('already gone')),
    }

    await expect(
      unloadNullSink(
        { moduleId: '7', sinkName: 's', monitorSource: 's.monitor' },
        deps
      )
    ).resolves.toBeUndefined()
  })
})
