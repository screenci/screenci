import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { stripVTControlCharacters } from 'node:util'
import {
  CiWorkflowError,
  detectIslandLockfile,
  registerCiWorkflowCommand,
  resolveWorkflowIsland,
  runCiWorkflowCommand,
  type CiWorkflowDeps,
} from './ciWorkflow.js'

function makeDeps(files: string[], cwd = '/repo') {
  const present = new Set(files)
  const written: Array<[string, string]> = []
  const dirs: string[] = []
  const logs: string[] = []
  const warnings: string[] = []
  const deps: CiWorkflowDeps = {
    cwd: () => cwd,
    existsSync: (path) => present.has(path),
    mkdir: async (dir) => {
      dirs.push(dir)
    },
    writeFile: async (path, content) => {
      written.push([path, content])
    },
    findRepoRoot: () => '/repo',
    detectIslandPackageManager: (islandDir) =>
      detectIslandLockfile(islandDir, (path) => present.has(path)),
    defaultPackageManager: () => 'npm',
    logger: {
      info: (message) => logs.push(stripVTControlCharacters(message)),
      warn: (message) => warnings.push(message),
    },
  }
  return { deps, written, dirs, logs, warnings }
}

describe('resolveWorkflowIsland', () => {
  it('accepts the workspace itself, the repository root above it, or --config', () => {
    const exists = (path: string) =>
      path === '/repo/screenci/screenci.config.ts'
    expect(resolveWorkflowIsland('/repo', undefined, exists)).toBe(
      '/repo/screenci'
    )
    expect(resolveWorkflowIsland('/repo/screenci', undefined, exists)).toBe(
      '/repo/screenci'
    )
    expect(
      resolveWorkflowIsland('/repo', 'screenci/screenci.config.ts', exists)
    ).toBe('/repo/screenci')
    expect(resolveWorkflowIsland('/elsewhere', undefined, exists)).toBeNull()
  })
})

describe('runCiWorkflowCommand', () => {
  it('writes the workflow for the nested workspace, keyed to its lockfile', async () => {
    const { deps, written, dirs, logs } = makeDeps([
      '/repo/screenci/screenci.config.ts',
      '/repo/screenci/pnpm-lock.yaml',
    ])
    const result = await runCiWorkflowCommand({ force: false }, deps)
    expect(result).toMatchObject({
      workflowPath: '/repo/.github/workflows/screenci.yaml',
      islandWorkflowPath: 'screenci',
      packageManager: 'pnpm',
    })
    expect(dirs).toEqual(['/repo/.github/workflows'])
    expect(written).toHaveLength(1)
    const [path, content] = written[0]!
    expect(path).toBe('/repo/.github/workflows/screenci.yaml')
    expect(content).toContain('working-directory: screenci')
    expect(content).toContain('cache-dependency-path: screenci/pnpm-lock.yaml')
    expect(content).toContain('pnpm exec screenci preview')
    expect(content).not.toContain('—')
    expect(logs.join('\n')).toContain(
      'Add SCREENCI_SECRET to the repository secrets'
    )
  })

  it('refuses to overwrite an existing workflow unless forced', async () => {
    const files = [
      '/repo/screenci/screenci.config.ts',
      '/repo/.github/workflows/screenci.yaml',
    ]
    const { deps, written } = makeDeps(files)
    await expect(runCiWorkflowCommand({ force: false }, deps)).rejects.toThrow(
      CiWorkflowError
    )
    expect(written).toHaveLength(0)
    await runCiWorkflowCommand({ force: true }, deps)
    expect(written).toHaveLength(1)
  })

  it('fails with guidance when no workspace is found', async () => {
    const { deps } = makeDeps([])
    await expect(runCiWorkflowCommand({ force: false }, deps)).rejects.toThrow(
      /No screenci workspace found/
    )
  })

  it('uses the explicit package manager over the lockfile', async () => {
    const { deps, written } = makeDeps([
      '/repo/screenci/screenci.config.ts',
      '/repo/screenci/yarn.lock',
    ])
    await runCiWorkflowCommand({ force: false, packageManager: 'npm' }, deps)
    expect(written[0]![1]).toContain('npx screenci preview')
  })
})

describe('registerCiWorkflowCommand', () => {
  it('parses the options and reports a refusal without throwing', async () => {
    const { deps, warnings, written } = makeDeps([
      '/repo/screenci/screenci.config.ts',
      '/repo/.github/workflows/screenci.yaml',
    ])
    const program = new Command()
    program.exitOverride()
    registerCiWorkflowCommand(program, deps)
    const previousExitCode = process.exitCode
    await program.parseAsync(['node', 'screenci', 'ci-workflow'])
    expect(warnings[0]).toContain('already exists')
    expect(written).toHaveLength(0)
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode

    await program.parseAsync([
      'node',
      'screenci',
      'ci-workflow',
      '--force',
      '--package-manager',
      'pnpm',
    ])
    expect(written).toHaveLength(1)
    expect(written[0]![1]).toContain('pnpm exec screenci preview')
  })
})
