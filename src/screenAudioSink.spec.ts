import { describe, it, expect, vi } from 'vitest'
import {
  assertPulseAudioAvailable,
  createNullSink,
  unloadNullSink,
  workerSinkName,
  type SinkDeps,
} from './screenAudioSink.js'

describe('assertPulseAudioAvailable', () => {
  it('resolves when both pulseaudio and pactl are present', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'pulseaudio 15.0\n' })
    await expect(assertPulseAudioAvailable({ run })).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledWith('pulseaudio', ['--version'])
    expect(run).toHaveBeenCalledWith('pactl', ['--version'])
  })

  it('throws when pulseaudio is missing', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn pulseaudio ENOENT'))
    await expect(assertPulseAudioAvailable({ run })).rejects.toThrow(
      /"pulseaudio" is not installed/
    )
  })

  it('throws when pactl is missing', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'pulseaudio 15.0\n' })
      .mockRejectedValueOnce(new Error('spawn pactl ENOENT'))
    await expect(assertPulseAudioAvailable({ run })).rejects.toThrow(
      /"pactl" is not installed/
    )
  })

  it('mentions the package to install in the error', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn pulseaudio ENOENT'))
    await expect(assertPulseAudioAvailable({ run })).rejects.toThrow(
      /Install the "pulseaudio" package/
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
