import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * An opaque, random id for this machine, persisted under the user's home so a
 * restarted `screenci edit` or a rerun `screenci setup` is recognised as the
 * same machine. Deliberately NOT the hostname: the backend only needs a
 * stable key, and a hostname leaks a name the user never chose to share.
 */
export type MachineIdFs = {
  readFile: (path: string) => string
  writeFile: (path: string, content: string) => void
  mkdir: (path: string) => void
}

const ID_PATTERN = /^[0-9a-f-]{16,64}$/

export const nodeMachineIdFs: MachineIdFs = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
}

export function getOrCreateMachineId(
  deps: {
    fs?: MachineIdFs
    homeDir?: string
    newId?: () => string
  } = {}
): string {
  const fs = deps.fs ?? nodeMachineIdFs
  const dir = join(deps.homeDir ?? homedir(), '.screenci')
  const path = join(dir, 'machine-id')
  try {
    const existing = fs.readFile(path).trim()
    if (ID_PATTERN.test(existing)) return existing
  } catch {
    // Missing or unreadable: mint a new one below.
  }
  const id = (deps.newId ?? randomUUID)()
  try {
    fs.mkdir(dir)
    fs.writeFile(path, `${id}\n`)
  } catch {
    // A read-only home still works: the id just lasts for this process.
  }
  return id
}
