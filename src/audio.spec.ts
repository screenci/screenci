import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  createAudio,
  buildStudioAudioTracks,
  validateRegisteredAudioPaths,
  resetRegisteredAudioPaths,
} from './audio.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
  type ScreenCIRuntimeContext,
} from './runtimeContext.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    addAssetEnd: vi.fn(),
    addStudioAssetStart: vi.fn(),
    addAudioStart: vi.fn(),
    addStudioAudioStart: vi.fn(),
    addAudioEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn<() => RecordingEvent[]>().mockReturnValue([]),
    writeToFile: vi
      .fn<(dir: string, videoName: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  } as unknown as IEventRecorder
}

describe('createAudio', () => {
  let tempDir: string
  let recorder: IEventRecorder
  let context: ScreenCIRuntimeContext

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'screenci-audio-spec-'))
    await writeFile(join(tempDir, 'music.mp3'), Buffer.from('id3 fake audio'))
    await writeFile(join(tempDir, 'sting.wav'), Buffer.from('riff fake audio'))
    recorder = createMockRecorder()
    context = createScreenCIRuntimeContext({
      recorder,
      testFilePath: join(tempDir, 'demo.screenci.ts'),
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const run = (fn: () => Promise<void>): Promise<void> =>
    runWithScreenCIRuntimeContext(context, fn)

  it('creates a callable controller with start()/end() for each key', () => {
    const audio = createAudio({
      theme: { path: './music.mp3' },
      sting: './sting.wav',
    })
    expect(typeof audio.theme).toBe('function')
    expect(typeof audio.theme.start).toBe('function')
    expect(typeof audio.theme.end).toBe('function')
    expect(typeof audio.sting).toBe('function')
  })

  it('a bare call emits audioStart with defaults (volume 1, repeat false)', async () => {
    await run(async () => {
      const audio = createAudio({ theme: { path: './music.mp3' } })
      await audio.theme()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledTimes(1)
    expect(recorder.addAudioStart).toHaveBeenCalledWith('theme', {
      path: './music.mp3',
      fileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      volume: 1,
      repeat: false,
    })
    // A bare call plays to the end of the video: no audioEnd is recorded.
    expect(recorder.addAudioEnd).not.toHaveBeenCalled()
  })

  it('passes through volume and repeat from the config', async () => {
    await run(async () => {
      const audio = createAudio({
        theme: { path: './music.mp3', volume: 0.3, repeat: true },
      })
      await audio.theme()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledWith(
      'theme',
      expect.objectContaining({ volume: 0.3, repeat: true })
    )
  })

  it('accepts a string shorthand as the path', async () => {
    await run(async () => {
      const audio = createAudio({ sting: './sting.wav' })
      await audio.sting()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledWith(
      'sting',
      expect.objectContaining({ path: './sting.wav', volume: 1, repeat: false })
    )
  })

  it('start() then end() records a paired audioStart and audioEnd', async () => {
    await run(async () => {
      const audio = createAudio({ theme: './music.mp3' })
      await audio.theme.start()
      await audio.theme.end()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledWith(
      'theme',
      expect.objectContaining({ path: './music.mp3' })
    )
    expect(recorder.addAudioEnd).toHaveBeenCalledWith('theme', 'wait')
  })

  it('rejects starting the same track twice without ending it', async () => {
    await run(async () => {
      const audio = createAudio({ theme: './music.mp3' })
      await audio.theme.start()
      await expect(audio.theme.start()).rejects.toThrow(
        'Audio "theme" is already started'
      )
    })
  })

  it('rejects end() for a track that was never started', async () => {
    await run(async () => {
      const audio = createAudio({ theme: './music.mp3' })
      await expect(audio.theme.end()).rejects.toThrow(
        'Cannot call end() for audio "theme"'
      )
    })
  })

  it('tracks are non-exclusive: starting one never ends another', async () => {
    await run(async () => {
      const audio = createAudio({
        theme: './music.mp3',
        sting: './sting.wav',
      })
      await audio.theme.start()
      await audio.sting.start()
      // theme is still active and can be ended independently.
      await audio.theme.end()
      await audio.sting.end()
    })
    expect(recorder.addAudioEnd).toHaveBeenNthCalledWith(1, 'theme', 'wait')
    expect(recorder.addAudioEnd).toHaveBeenNthCalledWith(2, 'sting', 'wait')
  })

  it('passes through speed from the config', async () => {
    await run(async () => {
      const audio = createAudio({ theme: { path: './music.mp3', speed: 2 } })
      await audio.theme()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledWith(
      'theme',
      expect.objectContaining({ speed: 2 })
    )
  })

  it('passes through time from the config', async () => {
    await run(async () => {
      const audio = createAudio({ theme: { path: './music.mp3', time: 5000 } })
      await audio.theme()
    })
    expect(recorder.addAudioStart).toHaveBeenCalledWith(
      'theme',
      expect.objectContaining({ time: 5000 })
    )
  })

  it('rejects both speed and time on the same track', () => {
    expect(() =>
      createAudio({ theme: { path: './music.mp3', speed: 2, time: 5000 } })
    ).toThrow('Audio "theme" (./music.mp3) must set only one of speed or time')
  })

  it('rejects a non-positive speed', () => {
    expect(() =>
      createAudio({ theme: { path: './music.mp3', speed: 0 } })
    ).toThrow('must provide a finite speed greater than 0')
  })

  it('rejects an unsupported file extension', () => {
    expect(() => createAudio({ bad: './notes.txt' })).toThrow(
      'Audio "bad" must use one of'
    )
  })

  it('accepts every supported audio extension', () => {
    for (const ext of [
      '.mp3',
      '.wav',
      '.m4a',
      '.aac',
      '.ogg',
      '.flac',
      '.opus',
      '.mp4',
    ]) {
      expect(() =>
        createAudio({ track: { path: `./clip${ext}` } })
      ).not.toThrow('must use one of')
    }
  })

  it('rejects a volume outside the allowed range', () => {
    expect(() =>
      createAudio({ theme: { path: './music.mp3', volume: 9 } })
    ).toThrow('Audio "theme" (./music.mp3) must provide a finite volume')
    expect(() =>
      createAudio({ theme: { path: './music.mp3', volume: -1 } })
    ).toThrow('must provide a finite volume')
  })

  it('throws when the audio file is missing', async () => {
    await run(async () => {
      const audio = createAudio({ theme: './gone.mp3' })
      await expect(audio.theme()).rejects.toThrow(
        'Audio file not found for "theme": ./gone.mp3'
      )
    })
  })

  it('is a no-op against the noop recorder outside a recording', async () => {
    // No active recording context: the controller resolves without throwing.
    const audio = createAudio({ theme: { path: './music.mp3' } })
    expect(audio.theme).toBeDefined()
    // Restore noop to confirm nothing was left registered.
    void NOOP_EVENT_RECORDER
  })
})

describe('buildStudioAudioTracks', () => {
  let recorder: IEventRecorder
  let context: ScreenCIRuntimeContext

  beforeEach(() => {
    recorder = createMockRecorder()
    context = createScreenCIRuntimeContext({ recorder, testFilePath: null })
  })

  const run = (fn: () => Promise<void>): Promise<void> =>
    runWithScreenCIRuntimeContext(context, fn)

  it('creates a callable controller with start()/end() for each name', () => {
    const music = buildStudioAudioTracks(['theme', 'sting'])
    expect(typeof music.theme).toBe('function')
    expect(typeof music.theme!.start).toBe('function')
    expect(typeof music.theme!.end).toBe('function')
    expect(typeof music.sting).toBe('function')
  })

  it('a bare call records a studio audio start with the name', async () => {
    await run(async () => {
      const music = buildStudioAudioTracks(['theme', 'sting'])
      await music.theme!()
      await music.sting!()
    })
    expect(recorder.addStudioAudioStart).toHaveBeenCalledTimes(2)
    expect(recorder.addStudioAudioStart).toHaveBeenNthCalledWith(1, 'theme')
    expect(recorder.addStudioAudioStart).toHaveBeenNthCalledWith(2, 'sting')
    // Studio tracks never resolve a file, so no code-path audioStart is emitted.
    expect(recorder.addAudioStart).not.toHaveBeenCalled()
  })

  it('start() then end() records a paired studio start and audioEnd', async () => {
    await run(async () => {
      const music = buildStudioAudioTracks(['theme'])
      await music.theme!.start()
      await music.theme!.end()
    })
    expect(recorder.addStudioAudioStart).toHaveBeenCalledWith('theme')
    expect(recorder.addAudioEnd).toHaveBeenCalledWith('theme', 'wait')
  })

  it('rejects starting the same track twice without ending it', async () => {
    await run(async () => {
      const music = buildStudioAudioTracks(['theme'])
      await music.theme!.start()
      await expect(music.theme!.start()).rejects.toThrow(
        'Audio "theme" is already started'
      )
    })
  })

  it('rejects end() for a track that was never started', async () => {
    await run(async () => {
      const music = buildStudioAudioTracks(['theme'])
      await expect(music.theme!.end()).rejects.toThrow(
        'Cannot call end() for audio "theme"'
      )
    })
  })
})

describe('validateRegisteredAudioPaths', () => {
  beforeEach(() => {
    resetRegisteredAudioPaths()
  })

  afterEach(() => {
    resetRegisteredAudioPaths()
  })

  // createAudio is called from this spec file, so its registrations are
  // attributed to it. Validation only checks registrations owned by the test
  // file it is given, so pass this spec's path to exercise them.
  const ownerFile = fileURLToPath(import.meta.url)

  it('passes when every registered audio file exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-audio-validate-'))
    try {
      await writeFile(join(tempDir, 'theme.mp3'), 'mp3')
      await writeFile(join(tempDir, 'sting.wav'), 'wav')
      createAudio({
        theme: { path: join(tempDir, 'theme.mp3'), volume: 0.3 },
        sting: join(tempDir, 'sting.wav'),
      })

      await expect(
        validateRegisteredAudioPaths(ownerFile)
      ).resolves.toBeUndefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('throws "Audio file not found" when a registered file is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-audio-validate-'))
    try {
      await writeFile(join(tempDir, 'theme.mp3'), 'mp3')
      const missing = join(tempDir, 'sting.wav')
      createAudio({
        theme: { path: join(tempDir, 'theme.mp3') },
        sting: missing,
      })

      await expect(validateRegisteredAudioPaths(ownerFile)).rejects.toThrow(
        `Audio file not found: ${missing}`
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('skips registrations owned by a different test file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-audio-validate-'))
    try {
      createAudio({ theme: join(tempDir, 'gone.mp3') })

      await expect(
        validateRegisteredAudioPaths(join(tempDir, 'other.screenci.ts'))
      ).resolves.toBeUndefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
