/**
 * Start the local VieNeu-TTS and OmniVoice adapters used by the narration UI.
 */

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PORTS } = require('./config');
const { trackProcess } = require('./utils/portManager');

const NARRATION_PORT = PORTS.NARRATION;
const CHATTERBOX_PORT = PORTS.CHATTERBOX;
const UV_EXECUTABLE = process.env.UV_EXECUTABLE || 'uv';
const ROOT_DIR = path.join(__dirname, '..');
const TTS_DIR = path.join(__dirname, 'tts_service');

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

function startChatterboxService() {
  try {
    return spawnTtsService({
      script: 'omnivoice_service.py',
      port: CHATTERBOX_PORT,
      label: 'OmniVoice TTS',
      env: { CHATTERBOX_PORT: String(CHATTERBOX_PORT) }
    });
  } catch (error) {
    console.error(`❌ Error starting OmniVoice service: ${error.message}`);
    return null;
  }
}

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
    const chatterboxProcess = startChatterboxService();
    return { narrationProcess, chatterboxProcess };
  } catch (error) {
    console.error(`❌ Error starting VieNeu-TTS services: ${error.message}`);
    return null;
  }
}

module.exports = {
  startNarrationService,
  startChatterboxService,
  NARRATION_PORT,
  CHATTERBOX_PORT
};
