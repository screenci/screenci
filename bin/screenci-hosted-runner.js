#!/usr/bin/env node

import { runHostedRunnerMain } from '../dist/src/hostedRunner.js'

runHostedRunnerMain()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
