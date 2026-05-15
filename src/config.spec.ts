import { describe, it, expect } from 'vitest'
import { defineConfig } from './config.js'

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

  it('should force fullyParallel to false', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.fullyParallel).toBe(false)
  })

  it('should force workers to 1', () => {
    const config = defineConfig({ projectName: 'Test' })

    expect(config.workers).toBe(1)
  })

  it('should throw error when workers is defined', () => {
    expect(() => {
      defineConfig({
        workers: 1,
      } as never)
    }).toThrow('screenci does not support "workers" option')
  })

  it('should throw error when fullyParallel is defined', () => {
    expect(() => {
      defineConfig({
        fullyParallel: true,
      } as never)
    }).toThrow('screenci does not support "fullyParallel" option')
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
    expect(config.fullyParallel).toBe(false)
    expect(config.workers).toBe(1)
    expect(config.retries).toBe(0)
    expect(config.forbidOnly).toBe(true)
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

  it('should rewrite localhost baseURL inside the recording container', () => {
    const originalContainer = process.env.SCREENCI_IN_CONTAINER
    const originalBaseHost = process.env.SCREENCI_CONTAINER_BASE_HOST

    process.env.SCREENCI_IN_CONTAINER = 'true'
    process.env.SCREENCI_CONTAINER_BASE_HOST = 'host.docker.internal'

    try {
      const config = defineConfig({
        projectName: 'Test',
        use: {
          baseURL: 'http://localhost:4321/',
        },
      })

      expect(config.use?.baseURL).toBe('http://host.docker.internal:4321/')
    } finally {
      if (originalContainer === undefined) {
        delete process.env.SCREENCI_IN_CONTAINER
      } else {
        process.env.SCREENCI_IN_CONTAINER = originalContainer
      }

      if (originalBaseHost === undefined) {
        delete process.env.SCREENCI_CONTAINER_BASE_HOST
      } else {
        process.env.SCREENCI_CONTAINER_BASE_HOST = originalBaseHost
      }
    }
  })

  it('should rewrite localhost baseURL in project use inside the recording container', () => {
    const originalContainer = process.env.SCREENCI_IN_CONTAINER

    process.env.SCREENCI_IN_CONTAINER = 'true'

    try {
      const config = defineConfig({
        projectName: 'Test',
        projects: [
          {
            name: 'chromium',
            use: {
              baseURL: 'http://127.0.0.1:3000/',
            },
          },
        ],
      })

      expect(config.projects?.[0]?.use?.baseURL).toBe(
        'http://host.containers.internal:3000/'
      )
    } finally {
      if (originalContainer === undefined) {
        delete process.env.SCREENCI_IN_CONTAINER
      } else {
        process.env.SCREENCI_IN_CONTAINER = originalContainer
      }
    }
  })

  it('should reject webServer option', () => {
    expect(() => {
      defineConfig({
        projectName: 'Test',
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000',
        },
      })
    }).toThrow('screenci does not support "webServer" option')
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
