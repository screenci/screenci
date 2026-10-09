#!/usr/bin/env node

import { runSnapshotServerMain } from '../dist/src/snapshotServer.js'

const server = runSnapshotServerMain()

const shutdown = () => {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
