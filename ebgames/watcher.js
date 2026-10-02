#!/usr/bin/env node
const path = require('path');

process.env.QUEUE_CONFIG_PATH ||= path.join(__dirname, 'config.yml');

try {
  const watcher = require('../toymate/watcher');
  watcher.main().catch((error) => {
    console.error('[EB Games] Fatal:', error);
    if (typeof process.send === 'function') {
      process.send({ source: 'ebgames', type: 'error', message: String(error.message || error) });
    }
    process.exitCode = 1;
  });
} catch (error) {
  console.error('[EB Games] Startup failed:', error);
  if (typeof process.send === 'function') {
    process.send({ source: 'ebgames', type: 'error', message: String(error.message || error) });
  }
  process.exitCode = 1;
}
