#!/usr/bin/env node

import { runCreateScreenciCli } from 'screenci/init'

runCreateScreenciCli().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
