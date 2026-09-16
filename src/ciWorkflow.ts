import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import {
  determinePackageManager,
  findRepositoryRoot,
  generateGithubAction,
  parsePackageManager,
  toWorkflowPath,
  type PackageManager,
} from './init.js'
import { logger } from './logger.js'

/**
 * `screenci ci-workflow`: writes the GitHub Actions recording workflow for
 * the repository's `screenci/` workspace. The "Add to CI" brief has the agent
 * run this instead of hand-writing YAML; `screenci init` no longer adds one
 * on its own. Other CI providers get templates in the docs (ci-setup).
 */

export const CI_WORKFLOW_RELATIVE_PATH = '.github/workflows/screenci.yaml'

export interface CiWorkflowOptions {
  /** Path to the workspace config; default: found from the cwd. */
  config?: string | undefined
  packageManager?: PackageManager | undefined
  /** Overwrite an existing workflow file. */
  force: boolean
}

export interface CiWorkflowDeps {
  cwd: () => string
  existsSync: (path: string) => boolean
  mkdir: (dir: string) => Promise<void>
  writeFile: (path: string, content: string) => Promise<void>
  findRepoRoot: (startDir: string) => string
  /** The workspace's own package manager, from its lockfile. */
  detectIslandPackageManager: (islandDir: string) => PackageManager | null
  defaultPackageManager: (cwd: string) => PackageManager
  logger: { info(message: string): void; warn(message: string): void }
}

export type CiWorkflowResult = {
  workflowPath: string
  islandDir: string
  repoRoot: string
  packageManager: PackageManager
  islandWorkflowPath: string
}

export class CiWorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CiWorkflowError'
  }
}

export function createDefaultCiWorkflowDeps(): CiWorkflowDeps {
  return {
    cwd: () => process.cwd(),
    existsSync,
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true })
    },
    writeFile: async (path, content) => {
      await writeFile(path, content)
    },
    findRepoRoot: findRepositoryRoot,
    detectIslandPackageManager: (islandDir) =>
      detectIslandLockfile(islandDir, existsSync),
    defaultPackageManager: (cwd) => determinePackageManager(cwd),
    logger,
  }
}

/** The package manager the workspace was scaffolded with, from ITS lockfile. */
export function detectIslandLockfile(
  islandDir: string,
  exists: (path: string) => boolean
): PackageManager | null {
  if (exists(resolve(islandDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (exists(resolve(islandDir, 'yarn.lock'))) return 'yarn'
  if (exists(resolve(islandDir, 'package-lock.json'))) return 'npm'
  return null
}

/**
 * The workspace to generate for: `--config`, a flat `screenci.config.ts` in
 * the cwd (inside the workspace), or `screenci/screenci.config.ts` under it
 * (the repository root, where the brief runs the command).
 */
export function resolveWorkflowIsland(
  cwd: string,
  configPath: string | undefined,
  exists: (path: string) => boolean
): string | null {
  if (configPath !== undefined) {
    const resolved = resolve(cwd, configPath)
    return exists(resolved) ? dirname(resolved) : null
  }
  if (exists(resolve(cwd, 'screenci.config.ts'))) return cwd
  if (exists(resolve(cwd, 'screenci', 'screenci.config.ts'))) {
    return resolve(cwd, 'screenci')
  }
  return null
}

export async function runCiWorkflowCommand(
  options: CiWorkflowOptions,
  deps: CiWorkflowDeps
): Promise<CiWorkflowResult> {
  const cwd = deps.cwd()
  const islandDir = resolveWorkflowIsland(cwd, options.config, deps.existsSync)
  if (islandDir === null) {
    throw new CiWorkflowError(
      'No screenci workspace found: run this from the repository root that contains screenci/screenci.config.ts (or pass --config <path>).'
    )
  }
  const repoRoot = deps.findRepoRoot(islandDir)
  const islandWorkflowPath = toWorkflowPath(relative(repoRoot, islandDir))
  const packageManager =
    options.packageManager ??
    deps.detectIslandPackageManager(islandDir) ??
    deps.defaultPackageManager(islandDir)
  const workflowPath = resolve(repoRoot, CI_WORKFLOW_RELATIVE_PATH)
  if (deps.existsSync(workflowPath) && !options.force) {
    throw new CiWorkflowError(
      `${CI_WORKFLOW_RELATIVE_PATH} already exists. Review it instead, or rerun with --force to replace it.`
    )
  }
  await deps.mkdir(dirname(workflowPath))
  await deps.writeFile(
    workflowPath,
    generateGithubAction(packageManager, islandWorkflowPath)
  )
  deps.logger.info(
    `${pc.green('✔')} Wrote ${CI_WORKFLOW_RELATIVE_PATH} for the ${packageManager} workspace at ${islandWorkflowPath}/.`
  )
  deps.logger.info(
    'It records on every push to main, on manual dispatch, and on every pull request (posting the previews on the pull request). Add SCREENCI_SECRET to the repository secrets (Settings > Secrets and variables > Actions), commit the workflow, and push.'
  )
  return {
    workflowPath,
    islandDir,
    repoRoot,
    packageManager,
    islandWorkflowPath,
  }
}

export function registerCiWorkflowCommand(
  program: Command,
  deps: CiWorkflowDeps
): Command {
  return program
    .command('ci-workflow')
    .description(
      'Write the GitHub Actions workflow that records this workspace from CI (other providers: see the CI setup docs)'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option(
      '--package-manager <manager>',
      'package manager the workspace uses: npm, pnpm, or yarn (default: from its lockfile)'
    )
    .option('--force', 'overwrite an existing workflow file')
    .action(async (options: Record<string, unknown>) => {
      const config = options['config'] as string | undefined
      const manager = options['packageManager'] as string | undefined
      try {
        await runCiWorkflowCommand(
          {
            ...(config !== undefined ? { config } : {}),
            ...(manager !== undefined
              ? { packageManager: parsePackageManager(manager, deps.cwd()) }
              : {}),
            force: options['force'] === true,
          },
          deps
        )
      } catch (err) {
        if (err instanceof CiWorkflowError) {
          deps.logger.warn(err.message)
          process.exitCode = 1
          return
        }
        throw err
      }
    })
}
