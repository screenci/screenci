import { describe, it, expect, vi } from 'vitest'
import { defineConfig } from './config.js'

describe('defineConfig', () => {
  it('should default recordingDir to ./recordings', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.testDir).toBe('./recordings')
  })

  it('should allow overriding recordingDir', () => {
    const config = defineConfig({
      projectName: 'Test',
      recordingDir: './custom-recordings',
    })

    expect(config.testDir).toBe('./custom-recordings')
  })

  it('should throw error when testDir is defined', () => {
    expect(() => {
      defineConfig({
        testDir: './tests',
      } as never)
    }).toThrow('screenci does not support "testDir" option')
  })

  it('should throw a migration error when the renamed videoDir is used', () => {
    expect(() => {
      defineConfig({
        projectName: 'Test',
        videoDir: './videos',
      } as never)
    }).toThrow('screenci renamed "videoDir" to "recordingDir"')
  })

  it('should pass through workers when defined', () => {
    const config = defineConfig({ projectName: 'Test', workers: 4 })

    expect(config.workers).toBe(4)
  })

  it('should pass through fullyParallel when defined', () => {
    const config = defineConfig({ projectName: 'Test', fullyParallel: true })

    expect(config.fullyParallel).toBe(true)
  })

  it('should accept all other playwright config options', () => {
    const config = defineConfig({
      projectName: 'Test',
      recordingDir: './my-recordings',
      forbidOnly: true,
      reporter: 'html',
      use: {
        trace: 'retain-on-failure',
      },
      projects: [
        {
          name: 'chromium',
          use: {},
        },
      ],
    })

    expect(config.testDir).toBe('./my-recordings')
    expect(config.fullyParallel).toBeUndefined()
    expect(config.workers).toBeUndefined()
    expect(config.retries).toBe(0)
    expect(config.forbidOnly).toBe(true)
    expect(config.reporter).toBe('html')
    expect(config.use?.trace).toBe('retain-on-failure')
  })

  it('leaves root use.trace undefined outside recording when omitted', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.use?.trace).toBeUndefined()
  })

  it('preserves root use.trace outside recording when configured', () => {
    const config = defineConfig({
      projectName: 'Test',
      use: {
        trace: 'on-first-retry',
      },
    })

    expect(config.use?.trace).toBe('on-first-retry')
  })

  it('should preserve project trace outside recording', () => {
    const config = defineConfig({
      projectName: 'Test',
      projects: [
        {
          name: 'chromium',
          use: {
            trace: 'on',
          },
        },
      ],
    })

    expect(config.projects?.[0].use?.trace).toBe('on')
  })

  it('leaves project use.trace undefined outside recording when omitted', () => {
    const config = defineConfig({
      projectName: 'Test',
      projects: [
        {
          name: 'chromium',
          use: {},
        },
      ],
    })

    expect(config.projects?.[0].use?.trace).toBeUndefined()
  })

  it('defaults record.upload to passed-only', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.record.upload).toBe('passed-only')
  })

  it('preserves record.upload when configured', () => {
    const config = defineConfig({
      projectName: 'Test',
      record: {
        upload: 'all-or-nothing',
      },
    })

    expect(config.record.upload).toBe('all-or-nothing')
  })

  it('defaults test.mockRecord to false', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.test.mockRecord).toBe(false)
  })

  it('preserves test.mockRecord when configured', () => {
    const config = defineConfig({
      projectName: 'Test',
      test: {
        mockRecord: true,
      },
    })

    expect(config.test.mockRecord).toBe(true)
  })

  it('should force retries to 0', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.retries).toBe(0)
  })

  it('should throw error when retries is defined', () => {
    expect(() => {
      defineConfig({
        retries: 2,
      } as never)
    }).toThrow('screenci does not support "retries" option')
  })

  it('should throw error when testMatch is defined', () => {
    expect(() => {
      defineConfig({
        testMatch: '**/*.test.ts',
      } as never)
    }).toThrow('screenci does not support "testMatch" option')
  })

  it('should force testMatch to the screenci pattern (plus the deprecated .video alias)', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.testMatch).toEqual([
      '**/*.screenci.?(c|m)[jt]s?(x)',
      '**/*.video.?(c|m)[jt]s?(x)',
    ])
  })

  it('should throw error when viewport is defined in use', () => {
    expect(() => {
      defineConfig({
        use: {
          viewport: { width: 1920, height: 1080 },
        },
      } as never)
    }).toThrow('screenci does not support "viewport" option')
  })

  it('should throw error when viewport is defined in project use', () => {
    expect(() => {
      defineConfig({
        projects: [
          {
            name: 'chromium',
            use: {
              viewport: { width: 1920, height: 1080 },
            },
          },
        ],
      } as never)
    }).toThrow(
      'screenci does not support "viewport" option in project "chromium"'
    )
  })

  it('should not throw error when viewport is not defined', () => {
    expect(() => {
      defineConfig({
        projectName: 'Test',
        use: {
          recordOptions: {
            aspectRatio: '16:9',
            quality: '1080p',
          },
        },
      })
    }).not.toThrow()
  })

  it('should accept recordOptions with aspectRatio and quality in use', () => {
    const config = defineConfig({
      projectName: 'Test',
      use: {
        recordOptions: {
          aspectRatio: '16:9',
          quality: '2160p',
          fps: 60,
        },
      },
    })

    // Config-level recordOptions are remapped onto the internal option fixture
    // the video/screenshot fixtures read, so they never collide with the public
    // Playwright option surface (removed from `video.use`).
    const use = config.use as Record<string, unknown>
    expect(use._screenciConfigRecordOptions).toEqual({
      aspectRatio: '16:9',
      quality: '2160p',
      fps: 60,
    })
    expect(use.recordOptions).toBeUndefined()
  })

  it('should accept baseURL in use', () => {
    const config = defineConfig({
      projectName: 'Test',
      use: {
        baseURL: 'https://app.example.com',
      },
    })

    expect(config.use?.baseURL).toBe('https://app.example.com')
  })

  it('should keep localhost baseURL unchanged while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        use: {
          baseURL: 'http://localhost:4321/',
        },
      })

      expect(config.use?.baseURL).toBe('http://localhost:4321/')
    } finally {
      delete process.env.SCREENCI_RECORDING
    }
  })

  it('should disable Playwright tracing while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        use: {
          trace: 'retain-on-failure',
        },
        projects: [
          {
            name: 'chromium',
            use: {
              trace: 'on',
            },
          },
        ],
      })

      expect(config.use?.trace).toBe('off')
      expect(config.projects?.[0].use?.trace).toBe('off')
    } finally {
      delete process.env.SCREENCI_RECORDING
    }
  })

  it('forces html reporter to never open while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        reporter: 'html',
      })

      expect(config.reporter).toEqual([['html', { open: 'never' }]])
    } finally {
      delete process.env.SCREENCI_RECORDING
    }
  })

  it('preserves non-html reporter config while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        reporter: 'list',
      })

      expect(config.reporter).toBe('list')
    } finally {
      delete process.env.SCREENCI_RECORDING
    }
  })

  it('signals the browser fixture to use audio mode when enableCaptureAudio is on while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      defineConfig({
        projectName: 'Test',
        enableCaptureAudio: true,
        use: {
          recordOptions: { captureAudio: 0.5 },
        },
      })

      expect(process.env.SCREENCI_CAPTURE_AUDIO).toBe('1')
    } finally {
      delete process.env.SCREENCI_RECORDING
      delete process.env.SCREENCI_CAPTURE_AUDIO
    }
  })

  it('does not signal audio mode when enableCaptureAudio is off, even if a video sets captureAudio', () => {
    process.env.SCREENCI_RECORDING = 'true'
    delete process.env.SCREENCI_CAPTURE_AUDIO

    try {
      defineConfig({
        projectName: 'Test',
        use: {
          recordOptions: { captureAudio: 1 },
        },
      })

      expect(process.env.SCREENCI_CAPTURE_AUDIO).toBeUndefined()
    } finally {
      delete process.env.SCREENCI_RECORDING
      delete process.env.SCREENCI_CAPTURE_AUDIO
    }
  })

  it('does not set the captureAudio env var when not recording', () => {
    delete process.env.SCREENCI_CAPTURE_AUDIO

    defineConfig({
      projectName: 'Test',
      use: {
        recordOptions: { captureAudio: 1 },
      },
    })

    expect(process.env.SCREENCI_CAPTURE_AUDIO).toBeUndefined()
  })

  it('does not warn for parallel workers (each captures its own isolated sink)', () => {
    process.env.SCREENCI_RECORDING = 'true'
    const workerIndex = process.env.TEST_WORKER_INDEX
    delete process.env.TEST_WORKER_INDEX
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      defineConfig({
        projectName: 'Test',
        enableCaptureAudio: true,
        workers: 4,
      })

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      delete process.env.SCREENCI_RECORDING
      delete process.env.SCREENCI_CAPTURE_AUDIO
      if (workerIndex !== undefined) process.env.TEST_WORKER_INDEX = workerIndex
    }
  })

  it('still bridges the audio-mode env from inside a worker', () => {
    process.env.SCREENCI_RECORDING = 'true'
    const workerIndex = process.env.TEST_WORKER_INDEX
    process.env.TEST_WORKER_INDEX = '0'

    try {
      defineConfig({
        projectName: 'Test',
        enableCaptureAudio: true,
        workers: 4,
      })

      expect(process.env.SCREENCI_CAPTURE_AUDIO).toBe('1')
    } finally {
      delete process.env.SCREENCI_RECORDING
      delete process.env.SCREENCI_CAPTURE_AUDIO
      if (workerIndex === undefined) delete process.env.TEST_WORKER_INDEX
      else process.env.TEST_WORKER_INDEX = workerIndex
    }
  })

  it('should accept webServer option', () => {
    const config = defineConfig({
      projectName: 'Test',
      webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
      },
    })

    expect(config.webServer).toEqual({
      command: 'npm run dev',
      url: 'http://localhost:3000',
    })
  })

  it('should accept recordOptions in project use', () => {
    const config = defineConfig({
      projectName: 'Test',
      projects: [
        {
          name: 'chromium',
          use: {
            recordOptions: {
              aspectRatio: '9:16',
              quality: '720p',
              fps: 24,
            },
          },
        },
      ],
    })

    const projectUse = config.projects?.[0].use as Record<string, unknown>
    expect(projectUse._screenciConfigRecordOptions).toEqual({
      aspectRatio: '9:16',
      quality: '720p',
      fps: 24,
    })
    expect(projectUse.recordOptions).toBeUndefined()
  })

  it('should accept all supported aspect ratios', () => {
    const aspectRatios = [
      '16:9',
      '9:16',
      '1:1',
      '4:3',
      '3:4',
      '5:4',
      '4:5',
    ] as const

    for (const aspectRatio of aspectRatios) {
      expect(() => {
        defineConfig({
          projectName: 'Test',
          use: { recordOptions: { aspectRatio } },
        })
      }).not.toThrow()
    }
  })

  it('should accept all supported quality presets', () => {
    const qualities = ['720p', '1080p', '1440p', '2160p'] as const

    for (const quality of qualities) {
      expect(() => {
        defineConfig({
          projectName: 'Test',
          use: { recordOptions: { quality } },
        })
      }).not.toThrow()
    }
  })
})
