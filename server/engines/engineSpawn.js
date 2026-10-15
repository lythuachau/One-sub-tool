const { spawn } = require('child_process');
const { PORTS } = require('../config');
const { getEngineVenv, projectRoot } = require('./venvPaths');
const { trackProcess } = require('../utils/portManager');
const catalog = require('./asrCatalog');
const { resolveUvExecutable } = require('./uvExecutable');

const ENTRIES = {
  parakeet: {
    entry: 'parakeet_wrapper/app.py',
    port: PORTS.PARAKEET,
    portEnv: 'PARAKEET_PORT',
    args: [],
  },
  ...catalog.spawnEntries(),
};

const spawnEngine = (id) => {
  const entry = ENTRIES[id];
  if (!entry) return null;

  const child = spawn(resolveUvExecutable(), [
    'run', '--python', getEngineVenv(id), 'python', entry.entry, ...(entry.args || []),
  ], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: process.env.VERBOSE === 'true' ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(entry.portEnv ? { [entry.portEnv]: String(entry.port) } : {}),
      ...(entry.extraEnv || {}),
    },
  });

  child.on('error', (error) => console.error(`ASR service ${id} failed to start:`, error.message));
  if (child.pid) trackProcess(entry.port, child.pid, `asr:${id}`);
  return child;
};

module.exports = { ENTRIES, spawnEngine };
