const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { spawnEngine } = require('./engineSpawn');
const { ENGINES } = require('./engineDefs');
const { getEnginesStatus, probeHealth } = require('./engineStatus');
const {
  clearEngineInstallMarker,
  markEngineInstalled,
  getEngineInstallMarker,
  markEngineInstalling,
  clearEngineInstalling,
  removeEngineVenv,
  projectRoot,
  ENGINE_IDS,
} = require('./venvPaths');
const { setAmbientSignal, clearAmbientSignal } = require('./installers/execHelpers');
const catalog = require('./asrCatalog');

const execFileAsync = promisify(execFile);
const installers = {
  parakeet: require('./installers/parakeet'),
  ...require('./installers/asrInstaller').asrInstallers(),
};
const state = {};
const stateOf = (id) => (state[id] || (state[id] = { child: null, install: null, installAbort: null }));
const engineDefOf = (id) => ENGINES.find((engine) => engine.id === id);
const requiredFreeGb = { parakeet: 8, ...catalog.requiredFreeGb() };
const installLogLimit = 800;
const readyTimeoutMs = 12000;
const startupGraceMs = 1200;

let installChain = Promise.resolve();
let installsInFlight = 0;

const freeBytes = (directory) => {
  try {
    const stats = fs.statfsSync(directory);
    return stats.bavail * stats.bsize;
  } catch (error) {
    return null;
  }
};

const checkFreeDisk = (id) => {
  const required = requiredFreeGb[id] || 6;
  const available = freeBytes(projectRoot);
  if (available !== null && available < required * 1024 ** 3) {
    throw new Error(`Not enough disk space for ${id}: needs about ${required} GB, ${(
      available / 1024 ** 3
    ).toFixed(1)} GB available.`);
  }
};

const milestonePercent = (line) => {
  const milestones = [
    [/creating .*venv|venv create/i, 8],
    [/pytorch|torch/i, 28],
    [/dependencies|faster-whisper|qwen-asr|onnx-asr/i, 52],
    [/modelscope|downloading model|forced aligner/i, 68],
    [/verify|verified/i, 92],
  ];
  return milestones.reduce((percent, [pattern, value]) => (pattern.test(line) ? Math.max(percent, value) : percent), 0);
};

const makeOnLog = (record) => (message) => {
  record.log.push(String(message));
  if (record.log.length > installLogLimit) record.log.shift();
  record.percent = Math.max(record.percent, milestonePercent(String(message)));
};

async function runInstall(id, installer, engineState, controller) {
  const onLog = makeOnLog(engineState.install);
  try {
    if (controller.signal.aborted) {
      engineState.install.error = 'Cancelled';
      return;
    }
    engineState.install.queued = false;
    checkFreeDisk(id);
    clearEngineInstallMarker(id);
    markEngineInstalling(id);
    setAmbientSignal(controller.signal);
    await installer.install({ onLog, signal: controller.signal });
    markEngineInstalled(id);
    engineState.install.done = true;
    engineState.install.percent = 100;
    engineState.install.completedAt = new Date().toISOString();
  } catch (error) {
    const cancelled = controller.signal.aborted || error?.cancelled;
    engineState.install.error = cancelled ? 'Cancelled' : error.message;
    onLog(`ERROR: ${engineState.install.error}`);
    removeEngineVenv(id);
  } finally {
    clearAmbientSignal();
    clearEngineInstalling(id);
    engineState.install.queued = false;
    engineState.install.running = false;
    installsInFlight -= 1;
  }
}

function install(id) {
  const installer = installers[id];
  if (!installer) throw new Error(`Unknown ASR engine: ${id}`);
  const engineState = stateOf(id);
  if (engineState.install?.running) return engineState.install;

  checkFreeDisk(id);
  const controller = new AbortController();
  engineState.installAbort = controller;
  engineState.install = {
    running: true,
    queued: installsInFlight > 0,
    percent: 0,
    log: [],
    error: null,
    done: false,
    startedAt: new Date().toISOString(),
  };
  if (installsInFlight > 0) makeOnLog(engineState.install)('Queued behind another model install.');
  installsInFlight += 1;
  installChain = installChain.then(() => runInstall(id, installer, engineState, controller));
  return engineState.install;
}

const getInstallProgress = (id) => state[id]?.install || {
  running: false,
  percent: 0,
  log: [],
  done: false,
  error: null,
};

const cancelInstall = (id) => {
  const engineState = state[id];
  if (!engineState?.install?.running) return false;
  engineState.installAbort?.abort();
  if (engineState.install.queued) {
    engineState.install.error = 'Cancelled';
    engineState.install.running = false;
  }
  return true;
};

const waitForReady = (child, engine, timeoutMs = readyTimeoutMs) => new Promise((resolve) => {
  let settled = false;
  const cleanup = () => {
    clearTimeout(timeout);
    child.off('error', onError);
    child.off('close', onClose);
  };
  const finish = (result) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(result);
  };
  const onError = (error) => finish({ error: error.message });
  const onClose = (code, signal) => finish({ exited: true, code, signal });
  child.once('error', onError);
  child.once('close', onClose);

  const deadline = Date.now() + timeoutMs;
  const check = async () => {
    if (settled) return;
    if (await probeHealth(engine)) return finish({ ok: true });
    if (Date.now() >= deadline) return finish({ pending: true });
    setTimeout(check, 1500);
  };
  const timeout = setTimeout(() => finish({ pending: true }), timeoutMs);
  setTimeout(check, startupGraceMs);
});

async function start(id) {
  const status = await getEnginesStatus();
  const info = status[id];
  if (!info) throw new Error(`Unknown ASR engine: ${id}`);
  if (info.running) return { alreadyRunning: true, healthy: true };
  if (!info.installed) throw new Error(`ASR engine "${id}" is not installed. Install it from Settings first.`);

  for (const otherId of ENGINE_IDS) {
    if (otherId !== id && status[otherId]?.running) {
      throw new Error(`Stop ${status[otherId].label} before starting ${info.label} to avoid competing for GPU memory.`);
    }
  }

  const engineState = stateOf(id);
  if (engineState.child && !engineState.child.killed) {
    const ready = await waitForReady(engineState.child, engineDefOf(id));
    if (ready.exited) engineState.child = null;
    else if (ready.error) throw new Error(`Failed to start ${info.label}: ${ready.error}`);
    else return { alreadyRunning: true, healthy: !!ready.ok, pending: !!ready.pending };
  }

  const child = spawnEngine(id);
  if (!child) throw new Error(`Unknown ASR engine: ${id}`);
  engineState.child = child;
  child.once('close', () => {
    if (state[id]?.child === child) state[id].child = null;
  });

  const ready = await waitForReady(child, engineDefOf(id));
  if (ready.exited) throw new Error(`${info.label} exited during startup (code ${ready.code ?? 'unknown'}). Check its runtime installation.`);
  if (ready.error) throw new Error(`Failed to start ${info.label}: ${ready.error}`);
  return { alreadyRunning: false, healthy: !!ready.ok, pending: !!ready.pending };
}

async function stop(id) {
  const engineState = state[id];
  const child = engineState?.child;
  if (!child?.pid) return false;
  engineState.child = null;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  } else {
    try { child.kill('SIGTERM'); } catch (error) { /* process already exited */ }
  }
  return true;
}

async function uninstall(id) {
  if (!installers[id]) throw new Error(`Unknown ASR engine: ${id}`);
  await stop(id);
  removeEngineVenv(id);
  clearEngineInstallMarker(id);
  clearEngineInstalling(id);
  if (state[id]) state[id].install = null;
  return true;
}

module.exports = { install, getInstallProgress, cancelInstall, start, stop, uninstall };
