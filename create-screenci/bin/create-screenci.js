#!/usr/bin/env node

// Self-contained launcher: runs `screenci init` through the invoking package
// manager's runner, pinned to this wrapper's own version. Node builtins only,
// so it works regardless of how the package manager laid out (or hoisted) the
// virtual store.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { selectRunner } from './select-runner.js'

const packageJsonPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'package.json'
)
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

const runner = selectRunner({
  userAgent: process.env.npm_config_user_agent,
  version,
  args: process.argv.slice(2),
  platform: process.platform,
  env: process.env,
})

const result = spawnSync(runner.command, runner.args, {
  stdio: 'inherit',
  ...(runner.windowsVerbatimArguments
    ? { windowsVerbatimArguments: true }
    : {}),
})

if (result.error) {
  console.error(`Failed to run ${runner.command}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
