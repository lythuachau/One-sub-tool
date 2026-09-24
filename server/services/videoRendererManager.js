const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PORTS } = require('../config');

const rendererRoot = path.resolve(__dirname, '..', '..', 'video-renderer');
const rendererEntry = path.join(rendererRoot, 'server', 'dist', 'index.js');
const rendererUrl = `http://127.0.0.1:${PORTS.VIDEO_RENDERER}`;
const healthTimeoutMs = 1500;
const startupTimeoutMs = 30000;

let rendererProcess = null;
let startupPromise = null;
let lastRendererError = null;

const runCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: rendererRoot,
    windowsHide: true,
    shell: process.platform === 'win32',
    ...options
  });
  let output = '';
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`${command} timed out after ${options.timeoutMs || 600000}ms`));
  }, options.timeoutMs || 600000);

  const appendOutput = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-8000);
  };

  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  child.on('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve(output);
    else reject(new Error(`${command} exited with code ${code}: ${output.trim()}`));
  });
});

const fetchHealth = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthTimeoutMs);

  try {
    const response = await fetch(`${rendererUrl}/health`, { signal: controller.signal });
    if (!response.ok) {
      return { running: false, status: 'unhealthy', httpStatus: response.status };
    }
    const data = await response.json();
    return { running: true, status: 'ok', ...data };
  } catch (error) {
    return {
      running: false,
      status: 'unavailable',
      error: error.name === 'AbortError' ? 'Health check timed out' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
};

const stopChildProcess = async (child) => {
  if (!child || child.killed) return;

  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      taskkill.on('close', resolve);
      taskkill.on('error', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
};

const waitForHealth = async () => {
  const deadline = Date.now() + startupTimeoutMs;
  let health = await fetchHealth();

  while (Date.now() < deadline) {
    if (health.running) return health;
    await new Promise((resolve) => setTimeout(resolve, 500));
    health = await fetchHealth();
  }

  throw new Error(health.error || `Video renderer did not become ready on port ${PORTS.VIDEO_RENDERER}`);
};

const startRenderer = async () => {
  const existingHealth = await fetchHealth();
  if (existingHealth.running) {
    lastRendererError = null;
    return existingHealth;
  }

  if (!fs.existsSync(rendererEntry)) {
    console.log('[VIDEO-RENDERER] Build output missing; building renderer server...');
    try {
      await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'server:build'], {
        timeoutMs: 600000
      });
    } catch (error) {
      if (!fs.existsSync(rendererEntry)) throw error;
      console.warn('[VIDEO-RENDERER] TypeScript build reported warnings but emitted a runnable server:', error.message);
    }
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCommand, ['run', 'server:start'], {
    cwd: rendererRoot,
    windowsHide: true,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PORT: String(PORTS.VIDEO_RENDERER)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  rendererProcess = child;
  lastRendererError = null;

  const logRendererOutput = (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[VIDEO-RENDERER] ${text}`);
  };
  child.stdout?.on('data', logRendererOutput);
  child.stderr?.on('data', logRendererOutput);
  child.on('error', (error) => {
    lastRendererError = error.message;
    console.error('[VIDEO-RENDERER] Process error:', error.message);
  });
  child.on('close', (code) => {
    if (rendererProcess === child) rendererProcess = null;
    if (code !== 0) {
      lastRendererError = `Renderer exited with code ${code}`;
      console.error(`[VIDEO-RENDERER] Process exited with code ${code}`);
    }
  });

  try {
    const health = await waitForHealth();
    console.log(`[VIDEO-RENDERER] Ready at ${rendererUrl}`);
    return health;
  } catch (error) {
    await stopChildProcess(child);
    if (rendererProcess === child) rendererProcess = null;
    lastRendererError = error.message;
    throw error;
  }
};

const ensureRenderer = async () => {
  if (startupPromise) return startupPromise;

  startupPromise = startRenderer().finally(() => {
    startupPromise = null;
  });

  return startupPromise;
};

const getRendererStatus = async () => {
  const health = await fetchHealth();
  return {
    ...health,
    port: PORTS.VIDEO_RENDERER,
    entryExists: fs.existsSync(rendererEntry),
    managedProcess: Boolean(rendererProcess),
    lastError: lastRendererError
  };
};

const stopRenderer = async () => {
  const child = rendererProcess;
  rendererProcess = null;
  await stopChildProcess(child);
};

module.exports = {
  ensureRenderer,
  getRendererStatus,
  stopRenderer,
  rendererUrl
};
