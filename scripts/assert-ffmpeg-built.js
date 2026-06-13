import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Verifies that ffmpeg-static's build (postinstall) script actually ran by
// resolving the bundled binary from the installed `screenci` package and
// checking the file exists and is non-empty.
//
// This catches package managers that silently skip dependency build scripts
// (pnpm 10/11 ignore them unless approved; npm 12 plans the same). A skipped
// script leaves ffmpeg-static exporting a path to a file that was never
// downloaded, so screenci's encoding fails only later at render time. Asserting
// the binary here turns that into a loud, immediate CI failure.
//
// Usage: node scripts/assert-ffmpeg-built.js <island-dir>

const islandDir = resolve(process.argv[2] ?? process.cwd())

// Seed a require from inside the island so module resolution matches what the
// generated project sees, then resolve ffmpeg-static the way screenci does
// (it is a transitive dependency, not a direct one).
const islandRequire = createRequire(resolve(islandDir, 'noop.js'))

let binaryPath
try {
  const screenciEntry = islandRequire.resolve('screenci')
  const screenciRequire = createRequire(screenciEntry)
  binaryPath = screenciRequire('ffmpeg-static')
} catch (err) {
  console.error(
    `Could not resolve ffmpeg-static from screenci in ${islandDir}: ${err.message}`
  )
  process.exit(1)
}

if (typeof binaryPath !== 'string' || binaryPath.length === 0) {
  console.error('ffmpeg-static did not export a binary path.')
  process.exit(1)
}

if (!existsSync(binaryPath) || statSync(binaryPath).size === 0) {
  console.error(
    `ffmpeg-static binary missing or empty at ${binaryPath}. ` +
      'The build/postinstall script was skipped by the package manager.'
  )
  process.exit(1)
}

console.log(
  `ffmpeg-static binary present at ${binaryPath} (${statSync(binaryPath).size} bytes).`
)
