import { describe, it, expect, vi } from 'vitest'
import {
  resolvePlatformAudioArgs,
  startScreenAudioCapture,
  isScreenAudioSupported,
  screenAudioUnsupportedMessage,
  setActiveCaptureDevice,
  type ScreenAudioDeps,
} from './screenAudio.js'
import { EventEmitter } from 'events'
import ffmpegStatic from 'ffmpeg-static'

const ffmpegPath = (ffmpegStatic as unknown as string | null) ?? 'ffmpeg'
import { Readable, Writable } from 'stream'

describe('isScreenAudioSupported', () => {
  it('is true only on linux', () => {
    expect(isScreenAudioSupported('linux')).toBe(true)
    expect(isScreenAudioSupported('darwin')).toBe(false)
    expect(isScreenAudioSupported('win32')).toBe(false)
  })
})

describe('screenAudioUnsupportedMessage', () => {
  it('returns null on linux', () => {
    expect(screenAudioUnsupportedMessage('linux')).toBeNull()
  })

  it('names the platform and only-on-Linux on darwin/win32', () => {
    const mac = screenAudioUnsupportedMessage('darwin')
    expect(mac).toContain('only supported on Linux')
    expect(mac).toContain('darwin')

    expect(screenAudioUnsupportedMessage('win32')).toContain('win32')
  })
})

describe('resolvePlatformAudioArgs', () => {
  it('returns pulse defaults on linux', () => {
    expect(resolvePlatformAudioArgs('linux')).toEqual({
      inputArgs: ['-f', 'pulse'],
      device: 'default.monitor',
    })
  })

  it('returns avfoundation defaults on darwin', () => {
    expect(resolvePlatformAudioArgs('darwin')).toEqual({
      inputArgs: ['-f', 'avfoundation'],
      device: ':0',
    })
  })

  it('returns wasapi loopback defaults on win32', () => {
    expect(resolvePlatformAudioArgs('win32')).toEqual({
      inputArgs: ['-f', 'wasapi', '-loopback', '1'],
      device: '',
    })
  })

  it('throws for unsupported platform', () => {
    expect(() => resolvePlatformAudioArgs('freebsd')).toThrow(
      /not supported on platform "freebsd"/
    )
  })

  it('uses the worker capture device while keeping input args', () => {
    expect(resolvePlatformAudioArgs('linux', 'screenci_1.monitor')).toEqual({
      inputArgs: ['-f', 'pulse'],
      device: 'screenci_1.monitor',
    })

    expect(resolvePlatformAudioArgs('darwin', ':2')).toEqual({
      inputArgs: ['-f', 'avfoundation'],
      device: ':2',
    })
  })

  it('falls back to the platform default when no device is set', () => {
    expect(resolvePlatformAudioArgs('linux', null).device).toBe(
      'default.monitor'
    )
  })

  it('defaults to the worker capture device set via setActiveCaptureDevice', () => {
    try {
      setActiveCaptureDevice('screenci_99.monitor')
      expect(resolvePlatformAudioArgs('linux').device).toBe(
        'screenci_99.monitor'
      )
    } finally {
      setActiveCaptureDevice(null)
    }
    expect(resolvePlatformAudioArgs('linux').device).toBe('default.monitor')
  })

  it('still throws for an unsupported platform even when a device is set', () => {
    expect(() => resolvePlatformAudioArgs('freebsd', 'whatever')).toThrow(
      /not supported on platform "freebsd"/
    )
  })
})

// Minimal fake ChildProcess for testing startScreenAudioCapture.
function makeFakeProc(opts: { failSpawn?: boolean } = {}) {
  const emitter = new EventEmitter() as NodeJS.EventEmitter & {
    stdin: Writable | null
    stderr: Readable | null
    kill: (signal?: string) => void
  }
  const stdinWrites: string[] = []
  emitter.stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(chunk.toString())
      cb()
    },
  })
  emitter.stderr = new Readable({ read() {} })
  emitter.kill = vi.fn()

  if (opts.failSpawn) {
    process.nextTick(() => emitter.emit('error', new Error('spawn ENOENT')))
  }

  return { proc: emitter, stdinWrites }
}

describe('startScreenAudioCapture', () => {
  it('resolves with path and fileHash on clean exit', async () => {
    const fakeContent = Buffer.from('fake pcm audio')
    const { proc, stdinWrites } = makeFakeProc()

    const deps: ScreenAudioDeps = {
      spawn: vi
        .fn()
        .mockReturnValue(
          proc
        ) as unknown as typeof import('child_process').spawn,
      readFile: vi.fn().mockResolvedValue(fakeContent),
    }

    const capture = startScreenAudioCapture('/tmp/audio.wav', deps)
    const stopPromise = capture.stop()

    // Simulate ffmpeg exiting after receiving 'q'
    process.nextTick(() => proc.emit('exit', 0))

    const result = await stopPromise

    expect(stdinWrites).toContain('q')
    expect(result.path).toBe('/tmp/audio.wav')
    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects when spawn emits an error before stop', async () => {
    const { proc } = makeFakeProc({ failSpawn: true })

    const deps: ScreenAudioDeps = {
      spawn: vi
        .fn()
        .mockReturnValue(
          proc
        ) as unknown as typeof import('child_process').spawn,
      readFile: vi.fn(),
    }

    const capture = startScreenAudioCapture('/tmp/audio.wav', deps)

    await new Promise((r) => process.nextTick(r))

    await expect(capture.stop()).rejects.toThrow(/could not start ffmpeg/)
  })

  it('rejects when the output file is not written', async () => {
    const { proc } = makeFakeProc()

    const deps: ScreenAudioDeps = {
      spawn: vi
        .fn()
        .mockReturnValue(
          proc
        ) as unknown as typeof import('child_process').spawn,
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    }

    const capture = startScreenAudioCapture('/tmp/audio.wav', deps)
    const stopPromise = capture.stop()
    process.nextTick(() => proc.emit('exit', 0))

    await expect(stopPromise).rejects.toThrow(/audio file was not written/)
  })

  it('rejects when ffmpeg exits with a non-zero code', async () => {
    const { proc } = makeFakeProc()

    const deps: ScreenAudioDeps = {
      spawn: vi
        .fn()
        .mockReturnValue(
          proc
        ) as unknown as typeof import('child_process').spawn,
      readFile: vi.fn(),
    }

    const capture = startScreenAudioCapture('/tmp/audio.wav', deps)
    const stopPromise = capture.stop()
    proc.stderr?.push('No such device: screenci_123.monitor\n')
    process.nextTick(() => proc.emit('exit', 1))

    await expect(stopPromise).rejects.toThrow(/exited with code 1/)
  })

  it('includes ffmpeg stderr output in the exit-code error', async () => {
    const { proc } = makeFakeProc()

    const deps: ScreenAudioDeps = {
      spawn: vi
        .fn()
        .mockReturnValue(
          proc
        ) as unknown as typeof import('child_process').spawn,
      readFile: vi.fn(),
    }

    const capture = startScreenAudioCapture('/tmp/audio.wav', deps)
    const stopPromise = capture.stop()
    proc.stderr?.push('Connection refused\n')
    process.nextTick(() => proc.emit('exit', 1))

    await expect(stopPromise).rejects.toThrow(/Connection refused/)
  })

  it('passes the platform audio args to ffmpeg', () => {
    const { proc } = makeFakeProc()
    const spawnMock = vi.fn().mockReturnValue(proc)

    const deps: ScreenAudioDeps = {
      spawn: spawnMock as unknown as typeof import('child_process').spawn,
      readFile: vi.fn(),
    }

    startScreenAudioCapture('/out.wav', deps)

    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]]
    expect(cmd).toBe(ffmpegPath)
    expect(args).toContain('-f')
    expect(args).toContain('-i')
  })
})
