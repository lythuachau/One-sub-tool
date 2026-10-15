const { executeWithRetry } = require('./execHelpers');

const SERVICE_DEPS = [
  'fastapi>=0.104.0',
  'uvicorn[standard]>=0.24.0',
  'python-multipart>=0.0.6',
  'pydantic>=2.0.0',
  'click',
  'pydub',
  'huggingface_hub',
  'python-dateutil',
];

async function installServiceDeps(venv, { logger } = {}) {
  if (logger && logger.progress) logger.progress('Installing local ASR service dependencies');
  await executeWithRetry(
    'uv',
    ['pip', 'install', '--python', venv, ...SERVICE_DEPS],
    { label: 'engine service dependencies', env: { UV_HTTP_TIMEOUT: '300' }, logger }
  );
}

module.exports = { installServiceDeps, SERVICE_DEPS };
