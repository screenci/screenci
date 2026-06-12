#!/usr/bin/env node

import { logCliError, main } from '../dist/cli.js'

main().catch((error) => {
  logCliError(error)
  process.exit(1)
})
