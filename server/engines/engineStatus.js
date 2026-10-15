/**
 * Per-engine availability probe — disk-installed + live health — that backs GET /api/engines/status.
 *
 * This replaces scattered per-method availability checks:
 * availability becomes PER-ENGINE at runtime instead of a single global flag. Read-only; nothing is
 * started or installed here.
 */

const fs = require('fs');
const path = require('path');
const { ENGINES } = require('./engineDefs');
const {
  getEngineInstallMarker,
  getEngineVenv,
  getEngineVenvTarget,
  isPackaged,
} = require('./venvPaths');

const venvLooksUsable = (venv) => fs.existsSync(venv) && fs.existsSync(path.join(venv, 'pyvenv.cfg'));

// "Installed" means this engine's own install completed successfully and left a marker in its
// per-engine venv. Do not use getEngineVenv() here: it intentionally falls back to shared .venv for
// migration launches, which would make a clean base install look like every engine was installed.
const isInstalled = (engine) => {
  try {
    if (!fs.existsSync(engine.entryFile)) return false;
    const venv = isPackaged() ? getEngineVenv(engine.id) : getEngineVenvTarget(engine.id);
    if (!venvLooksUsable(venv)) return false;
    return isPackaged() || fs.existsSync(getEngineInstallMarker(engine.id));
  } catch (error) {
    return false;
  }
};

const probeHealth = async (engine, timeoutMs = 1500) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`http://127.0.0.1:${engine.port}${engine.health.path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    let json = null;
    try { json = await resp.json(); } catch (error) { /* health body may be non-JSON */ }
    return engine.health.isReady(resp.status, json);
  } catch (error) {
    return false; // unreachable / timed out = not running
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @returns {Promise<Object>} map of engineId -> { id, label, port, installed, running, state }
 *   state: 'not-installed' | 'installed-stopped' | 'ready' (running implies ready/usable)
 */
const getEnginesStatus = async () => {
  const entries = await Promise.all(ENGINES.map(async (engine) => {
    const installed = isInstalled(engine);
    const running = await probeHealth(engine);
    const state = running ? 'ready' : (installed ? 'installed-stopped' : 'not-installed');
    return [engine.id, {
      id: engine.id,
      label: engine.label,
      port: engine.port,
      installed,
      running,
      state,
      managedByElectron: isPackaged(),
    }];
  }));
  return Object.fromEntries(entries);
};

module.exports = { getEnginesStatus, probeHealth };
