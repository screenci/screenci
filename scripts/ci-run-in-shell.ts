import { spawnSync } from 'node:child_process'

type ShellName = 'bash' | 'pwsh' | 'cmd'

const VALID_SHELLS = new Set<ShellName>(['bash', 'pwsh', 'cmd'])

function parseShellName(value: string | undefined): ShellName {
  if (value === undefined || !VALID_SHELLS.has(value as ShellName)) {
    throw new Error('Expected shell_name to be one of: bash, pwsh, cmd')
  }
  return value as ShellName
}

function runInShell(shellName: ShellName, command: string): void {
  let program: string
  let args: string[]

  if (shellName === 'bash') {
    program = 'bash'
    args = ['-lc', command]
  } else if (shellName === 'pwsh') {
    program = 'pwsh'
    args = ['-Command', command]
  } else {
    program = 'cmd'
    args = ['/d', '/s', '/c', command]
  }

  const result = spawnSync(program, args, { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${program} exited with code ${result.status}`)
  }
}

function main(): void {
  const shellName = parseShellName(process.argv[2])
  const command = process.argv.slice(3).join(' ')

  if (!command) {
    throw new Error('Expected a command to run')
  }

  runInShell(shellName, command)
}

try {
  main()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
