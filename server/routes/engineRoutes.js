/**
 * Routes for per-engine status + on-demand lifecycle (install / start / stop). Additive: this runs
 * alongside the legacy /api/startup-mode flag during the OSG-unification migration.
 */

const express = require('express');
const { getEnginesStatus } = require('../engines/engineStatus');
const { ENGINE_IDS } = require('../engines/venvPaths');
const engineManager = require('../engines/engineManager');

const router = express.Router();

const isKnown = (id) => ENGINE_IDS.includes(id);
const isElectronManaged = () => process.env.ELECTRON_MANAGES_PYTHON === 'true';

// GET /api/engines/status — per-engine availability (disk-installed + live health).
router.get('/engines/status', async (req, res) => {
  try {
    res.json({ engines: await getEnginesStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message, engines: {} });
  }
});

// POST /api/engines/:id/install — kick off the per-engine venv install (runs in the background).
router.post('/engines/:id/install', (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  if (isElectronManaged()) {
    return res.status(409).json({ error: 'Python engines are managed by the packaged Electron app.' });
  }
  try {
    const progress = engineManager.install(id);
    res.status(202).json({ ok: true, progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/engines/:id/install-progress — poll an in-flight (or last) install.
router.get('/engines/:id/install-progress', (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  res.json(engineManager.getInstallProgress(id));
});

// POST /api/engines/:id/install/cancel — abort an in-flight (or queued) install.
router.post('/engines/:id/install/cancel', (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  res.json({ ok: engineManager.cancelInstall(id) });
});

// POST /api/engines/:id/start — spawn the engine's Python service.
router.post('/engines/:id/start', async (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  if (isElectronManaged()) return res.json({ ok: true, managedByElectron: true });
  try {
    const result = await engineManager.start(id);
    res.json({ ok: true, alreadyRunning: !!result.alreadyRunning, healthy: !!result.healthy, pending: !!result.pending });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/engines/:id/uninstall — stop the engine and remove its venv (re-installable after).
router.post('/engines/:id/uninstall', async (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  if (isElectronManaged()) {
    return res.status(409).json({ error: 'Python engines are managed by the packaged Electron app.' });
  }
  try {
    res.json({ ok: await engineManager.uninstall(id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/engines/:id/stop — stop the engine's Python service.
router.post('/engines/:id/stop', async (req, res) => {
  const { id } = req.params;
  if (!isKnown(id)) return res.status(404).json({ error: `Unknown engine: ${id}` });
  if (isElectronManaged()) return res.json({ ok: false, managedByElectron: true });
  try {
    res.json({ ok: await engineManager.stop(id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
