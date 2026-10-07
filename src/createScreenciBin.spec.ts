import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultResolveWindowsShim,
  detectPackageManager,
  quoteWindowsBatchArg,
  selectRunner,
} from '../create-screenci/bin/select-runner.js'

const base = { version: '1.2.3', args: ['--name', 'demo'] }

describe('selectRunner', () => {
  it('uses pnpm dlx when invoked through pnpm', () => {
    expect(
      selectRunner({
        ...base,
        userAgent: 'pnpm/11.0.0 npm/? node/v22.0.0 linux x64',
        platform: 'linux',
      })
    ).toEqual({
      command: 'pnpm',
      args: [
        '--config.minimum-release-age-exclude=screenci',
        '--config.enable-global-virtual-store=false',
        'dlx',
        '--package=screenci@1.2.3',
        'screenci',
        'init',
        '--name',
        'demo',
      ],
    })
  })

  it('uses yarn dlx when invoked through yarn', () => {
    expect(
      selectRunner({
        ...base,
        userAgent: 'yarn/4.1.0 npm/? node/v22.0.0 darwin arm64',
        platform: 'darwin',
      })
    ).toEqual({
      command: 'yarn',
      args: [
        'dlx',
        '-p',
        'screenci@1.2.3',
        'screenci',
        'init',
        '--name',
        'demo',
      ],
    })
  })

  it('falls back to npx --yes for npm and unknown user agents', () => {
    for (const userAgent of [
      'npm/10.0.0 node/v22.0.0 linux x64',
      undefined,
      '',
    ]) {
      expect(selectRunner({ ...base, userAgent, platform: 'linux' })).toEqual({
        command: 'npx',
        args: [
          '--yes',
          '--package=screenci@1.2.3',
          'screenci',
          'init',
          '--name',
          'demo',
        ],
      })
    }
  })

  it('forwards no extra args when none were given', () => {
    expect(
      selectRunner({
        version: '0.1.0',
        args: [],
        userAgent: undefined,
        platform: 'linux',
      }).args
    ).toEqual(['--yes', '--package=screenci@0.1.0', 'screenci', 'init'])
  })

  it('routes through cmd.exe with batch quoting on win32', () => {
    const result = selectRunner({
      version: '1.2.3',
      args: ['--name', 'my "demo" 100%'],
      userAgent: 'pnpm/11.0.0 npm/? node/v22.0.0 win32 x64',
      platform: 'win32',
      env: { comspec: 'C:\\Windows\\system32\\cmd.exe' },
      resolveWindowsShim: (name) => `C:\\node\\${name}.cmd`,
    })
    expect(result.command).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(result.windowsVerbatimArguments).toBe(true)
    expect(result.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(result.args[3]).toBe(
      '""C:\\node\\pnpm.cmd" "--config.minimum-release-age-exclude=screenci" "--config.enable-global-virtual-store=false" "dlx" "--package=screenci@1.2.3" "screenci" "init" "--name" "my \\"demo\\" 100%%""'
    )
  })

  it('uses CREATE_SCREENCI_SCREENCI_SPEC as the package spec when set', () => {
    expect(
      selectRunner({
        ...base,
        userAgent: 'pnpm/11.0.0',
        platform: 'linux',
        env: { CREATE_SCREENCI_SCREENCI_SPEC: 'file:/tmp/screenci-1.2.3.tgz' },
      }).args
    ).toEqual([
      '--config.minimum-release-age-exclude=screenci',
      '--config.enable-global-virtual-store=false',
      'dlx',
      '--package=file:/tmp/screenci-1.2.3.tgz',
      'screenci',
      'init',
      '--name',
      'demo',
    ])
    expect(
      selectRunner({
        ...base,
        userAgent: undefined,
        platform: 'linux',
        env: { CREATE_SCREENCI_SCREENCI_SPEC: '  ' },
      }).args[1]
    ).toBe('--package=screenci@1.2.3')
  })

  it('defaults to cmd.exe when comspec is unset', () => {
    const result = selectRunner({
      ...base,
      userAgent: undefined,
      platform: 'win32',
      resolveWindowsShim: (name) => `${name}.cmd`,
    })
    expect(result.command).toBe('cmd.exe')
    expect(result.args[3]).toContain('"npx.cmd" "--yes"')
  })

  it('finds the shim on PATH, else next to node, else by bare name', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-screenci-'))
    const onPath = join(root, 'bin')
    mkdirSync(onPath)
    writeFileSync(join(onPath, 'npx.cmd'), '')
    expect(defaultResolveWindowsShim('npx', { PATH: onPath })).toBe(
      join(onPath, 'npx.cmd')
    )
    expect(defaultResolveWindowsShim('nonexistent-runner', { PATH: '' })).toBe(
      'nonexistent-runner.cmd'
    )
    rmSync(root, { recursive: true, force: true })
  })
})

describe('detectPackageManager', () => {
  it('reads the manager name before the slash', () => {
    expect(detectPackageManager('pnpm/9.0.0 npm/?')).toBe('pnpm')
    expect(detectPackageManager('yarn/1.22.0')).toBe('npm')
    expect(detectPackageManager('yarn/4.1.0 npm/? node/v22')).toBe('yarn')
    expect(detectPackageManager('npm/10.0.0')).toBe('npm')
    expect(detectPackageManager('bun/1.0.0')).toBe('npm')
    expect(detectPackageManager(undefined)).toBe('npm')
  })
})

describe('quoteWindowsBatchArg', () => {
  it('quotes empty, embedded-quote, trailing-backslash and percent args', () => {
    expect(quoteWindowsBatchArg('')).toBe('""')
    expect(quoteWindowsBatchArg('a"b')).toBe('"a\\"b"')
    expect(quoteWindowsBatchArg('C:\\dir\\')).toBe('"C:\\dir\\\\"')
    expect(quoteWindowsBatchArg('50%')).toBe('"50%%"')
  })
})
