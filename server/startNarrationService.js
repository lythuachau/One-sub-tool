/**
 * Start the local VieNeu-TTS and OmniVoice adapters used by the narration UI.
 */

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PORTS } = require('./config');
const { trackProcess } = require('./utils/portManager');

const NARRATION_PORT = PORTS.NARRATION;
const OMNIVOICE_PORT = PORTS.OMNIVOICE || PORTS.CHATTERBOX;
const CHATTERBOX_PORT = OMNIVOICE_PORT;
const UV_EXECUTABLE = process.env.UV_EXECUTABLE || 'uv';
const ROOT_DIR = path.join(__dirname, '..');
const TTS_DIR = path.join(__dirname, 'tts_service');
const WARMUP_ENABLED = process.env.NARRATION_WARMUP !== 'false';

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

const waitForService = async ({ port, label, attempts = 120 }) => {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await sleep(1000);
  }
  throw new Error(`${label} service did not become reachable`);
};

const warmUpService = async ({ port, label, wakePath }) => {
  await waitForService({ port, label });
  console.log(`⏳ Warming up ${label} model...`);
  const response = await fetch(`http://127.0.0.1:${port}${wakePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${label} warm-up returned HTTP ${response.status}`);
  }
  console.log(`✅ ${label} model is ready`);
  return payload;
};

const warmUpNarrationServices = async () => {
  if (!WARMUP_ENABLED || typeof fetch !== 'function') return;

  const services = [
    { port: NARRATION_PORT, label: 'VieNeu-TTS', wakePath: '/api/narration/wake-up' },
    { port: CHATTERBOX_PORT, label: 'OmniVoice', wakePath: '/wake-up' }
  ];

  for (const service of services) {
    try {
      await warmUpService(service);
    } catch (error) {
      console.error(`⚠️ ${service.label} warm-up failed: ${error.message}`);
    }
  }
};

const resolvePythonCommand = () => {
  const configuredPython = process.env.TTS_PYTHON || process.env.NARRATION_PYTHON;
  if (configuredPython) return { command: configuredPython, prefix: [] };
  try {
    execFileSync(UV_EXECUTABLE, ['--version'], { encoding: 'utf8' });
    return { command: UV_EXECUTABLE, prefix: ['run', 'python'] };
  } catch (error) {
    throw new Error('uv is not installed. Set TTS_PYTHON to the OSG .venv Python executable or install uv.');
  }
};

const spawnTtsService = ({ script, port, label, env }) => {
  const scriptPath = path.join(TTS_DIR, script);
  if (!fs.existsSync(scriptPath)) {
    console.warn(`⚠️ ${label} adapter not found: ${scriptPath}`);
    return null;
  }

  const python = resolvePythonCommand();
  const child = spawn(python.command, [...python.prefix, scriptPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env, PYTHONUNBUFFERED: '1' },
    stdio: 'inherit'
  });
  child.on('error', error => console.error(`❌ Failed to start ${label}: ${error.message}`));
  child.on('close', code => { if (code !== 0) console.error(`❌ ${label} exited with code ${code}`); });
  if (child.pid) trackProcess(port, child.pid, label);
  console.log(`✅ ${label} starting on port ${port}`);
  return child;
};

function startOmniVoiceService() {
  try {
    return spawnTtsService({
      script: 'omnivoice_service.py',
      port: OMNIVOICE_PORT,
      label: 'OmniVoice TTS',
      env: {
        OMNIVOICE_PORT: String(OMNIVOICE_PORT),
        CHATTERBOX_PORT: String(OMNIVOICE_PORT)
      }
    });
  } catch (error) {
    console.error(`❌ Error starting OmniVoice service: ${error.message}`);
    return null;
  }
}

const startChatterboxService = startOmniVoiceService;

function startNarrationService() {
  try {
    const narrationProcess = spawnTtsService({
      script: 'vieneu_service.py',
      port: NARRATION_PORT,
      label: 'VieNeu-TTS narration',
      env: {
        NARRATION_PORT: String(NARRATION_PORT),
        VIENEU_BACKEND: process.env.VIENEU_BACKEND || 'onnx'
      }
    });
    const omnivoiceProcess = startOmniVoiceService();
    if (WARMUP_ENABLED) {
      setTimeout(() => { void warmUpNarrationServices(); }, 250);
    }
    return {
      narrationProcess,
      omnivoiceProcess,
      chatterboxProcess: omnivoiceProcess
    };
  } catch (error) {
    console.error(`❌ Error starting VieNeu-TTS services: ${error.message}`);
    return null;
  }
}

module.exports = {
  startNarrationService,
  startOmniVoiceService,
  startChatterboxService,
  warmUpNarrationServices,
  NARRATION_PORT,
  OMNIVOICE_PORT,
  CHATTERBOX_PORT
};
