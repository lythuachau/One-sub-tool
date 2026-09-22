const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const configuredPython = process.env.TTS_PYTHON || process.env.NARRATION_PYTHON;
const uv = process.env.UV_EXECUTABLE || 'uv';
const requirements = path.join(root, 'server', 'tts_service', 'requirements.txt');
const command = configuredPython || uv;
const args = configuredPython
  ? ['-m', 'pip', 'install', '-r', requirements]
  : ['pip', 'install', '--python', path.join(root, '.venv', 'Scripts', 'python.exe'), '-r', requirements];

const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(`Failed to install VieNeu-TTS and OmniVoice: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status || 0);
