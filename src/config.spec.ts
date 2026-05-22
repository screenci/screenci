import { describe, it, expect } from 'vitest'
import { defineConfig } from './config.js'

function getReporterNames(config: ReturnType<typeof defineConfig>): string[] {
  return (config.reporter ?? []).map((reporter) => reporter[0])
}

describe('defineConfig', () => {
  it('should default videoDir to ./videos', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.testDir).toBe('./videos')
  })

  it('should allow overriding videoDir', () => {
    const config = defineConfig({
      projectName: 'Test',
      videoDir: './custom-videos',
    })

    expect(config.testDir).toBe('./custom-videos')
  })

  it('should throw error when testDir is defined', () => {
    expect(() => {
      defineConfig({
        testDir: './tests',
      } as never)
    }).toThrow('screenci does not support "testDir" option')
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
      videoDir: './my-videos',
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

    expect(config.testDir).toBe('./my-videos')
    expect(config.fullyParallel).toBeUndefined()
    expect(config.workers).toBeUndefined()
    expect(config.retries).toBe(0)
    expect(config.forbidOnly).toBe(true)
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

  it('should force testMatch to **/*.video.?(c|m)[jt]s?(x)', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.testMatch).toBe('**/*.video.?(c|m)[jt]s?(x)')
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

    expect(config.use?.recordOptions).toEqual({
      aspectRatio: '16:9',
      quality: '2160p',
      fps: 60,
    })
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

  it('filters out the html reporter while recording', () => {
    process.env.SCREENCI_RECORDING = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        reporter: ['html', 'dot'],
      })

      expect(getReporterNames(config)).not.toContain('html')
      expect(getReporterNames(config)).toContain('dot')
      expect(
        getReporterNames(config).some((name) => name.endsWith('reporter.ts')) ||
          getReporterNames(config).some((name) => name.endsWith('reporter.js'))
      ).toBe(true)
    } finally {
      delete process.env.SCREENCI_RECORDING
    }
  })

  it('keeps reporter configuration unchanged outside recording', () => {
    const config = defineConfig({
      projectName: 'Test',
      reporter: ['html', 'dot'],
    })

    expect(getReporterNames(config)).toContain('html')
    expect(getReporterNames(config)).toContain('dot')
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

    expect(config.projects?.[0].use?.recordOptions).toEqual({
      aspectRatio: '9:16',
      quality: '720p',
      fps: 24,
    })
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
