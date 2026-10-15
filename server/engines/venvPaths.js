const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const ENGINE_IDS = ['parakeet', ...require('./asrCatalog').ids()];
const installStateDir = path.join(projectRoot, '.venvs', '.asr-install-state');

const getEngineVenvTarget = (id) => path.join(projectRoot, '.venvs', String(id));
const getEngineVenv = (id) => getEngineVenvTarget(id);
const getEngineInstallMarker = (id) => path.join(getEngineVenvTarget(id), '.one-sub-tool-asr-installed.json');
const getEngineInstallingMarker = (id) => path.join(installStateDir, `${String(id)}.installing.json`);

const writeMarker = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

const markEngineInstalled = (id, extra = {}) => writeMarker(getEngineInstallMarker(id), {
  id,
  installedAt: new Date().toISOString(),
  ...extra,
});

const clearEngineInstallMarker = (id) => fs.rmSync(getEngineInstallMarker(id), { force: true });
const markEngineInstalling = (id) => writeMarker(getEngineInstallingMarker(id), { id, startedAt: new Date().toISOString() });
const clearEngineInstalling = (id) => fs.rmSync(getEngineInstallingMarker(id), { force: true });
const isEngineInstalling = (id) => fs.existsSync(getEngineInstallingMarker(id));
const removeEngineVenv = (id) => fs.rmSync(getEngineVenvTarget(id), { recursive: true, force: true });

module.exports = {
  ENGINE_IDS,
  projectRoot,
  getEngineVenv,
  getEngineVenvTarget,
  getEngineInstallMarker,
  getEngineInstallingMarker,
  markEngineInstalled,
  clearEngineInstallMarker,
  markEngineInstalling,
  clearEngineInstalling,
  isEngineInstalling,
  removeEngineVenv,
  isPackaged: () => false,
};