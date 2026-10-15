/** Network retry and cancellation helpers for isolated local-ASR engine installation. */

const { spawn } = require('child_process');
const { resolveUvExecutable } = require('../uvExecutable');

const noopLogger = new Proxy({}, { get: () => () => {} });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ambient cancellation: the engine manager serializes installs (one at a time) and sets the active
// install's AbortSignal here. runCommand kills its child if that signal fires, so a user-requested
// cancel stops the in-flight step instead of running to completion. Explicit options.signal wins.
let ambientSignal = null;
const setAmbientSignal = (sig) => { ambientSignal = sig || null; };
const clearAmbientSignal = () => { ambientSignal = null; };

// Retry only on errors that look transient (network/timeout/DNS/TLS/HTTP 5xx) so a deterministic
// resolver/build error fails fast.
function looksTransient(error) {
  const msg = `${error && error.message ? error.message : ''} ${error && error.stderr ? error.stderr : ''}`.toLowerCase();
  return /timed out|timeout|connection|connreset|reset by peer|temporary failure|temporarily|network|getaddrinfo|enotfound|eai_again|could not resolve|failed to connect|ssl|tls|handshake|remote end hung up|rpc failed|early eof|http error 5\d\d|502|503|504|429|throttl|read error|broken pipe/.test(msg);
}

function formatCommand(command, args = []) {
  return [command, ...args.map((arg) => {
    const text = String(arg);
    return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
  })].join(' ');
}

function emitLines(chunk, buffer, onLine) {
  const text = buffer + chunk.toString();
  const lines = text.split(/\r?\n/);
  const nextBuffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed) onLine(trimmed);
  }
  return nextBuffer;
}

function runCommand(command, args = [], options = {}) {
  const {
    env: extraEnv = {},
    logger = noopLogger,
    label = command,
    cwd,
    stdio = ['ignore', 'pipe', 'pipe'],
    signal: optSignal,
  } = options;
  // Force Python UTF-8 mode so engine/verify output (which contains ✅ and other non-ASCII) doesn't
  // crash with UnicodeEncodeError on non-UTF-8 Windows consoles (e.g. Korean cp949).
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
  const signal = optSignal || ambientSignal;
  const executable = command === 'uv' ? resolveUvExecutable() : command;

  logger.command(formatCommand(command, args));

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(Object.assign(new Error(`${label} cancelled`), { cancelled: true }));
    }

    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio,
    });

    let stdout = '';
    let stderr = '';
    let outBuffer = '';
    let errBuffer = '';
    let settled = false;

    // Kill the child if the (ambient or explicit) cancel signal fires; the resulting close/exit
    // rejects the step and aborts the rest of the install.
    const onAbort = () => { try { child.kill(); } catch (e) { /* already gone */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const detachAbort = () => { if (signal) signal.removeEventListener('abort', onAbort); };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      detachAbort();
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        outBuffer = emitLines(chunk, outBuffer, (line) => logger.info(line));
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        errBuffer = emitLines(chunk, errBuffer, (line) => logger.warning(line));
      });
    }

    child.on('error', (error) => {
      rejectOnce(new Error(`${label} failed to start: ${error.message}`));
    });

    child.on('close', (code, closeSignal) => {
      if (settled) return;
      if (outBuffer.trim()) logger.info(outBuffer.trim());
      if (errBuffer.trim()) logger.warning(errBuffer.trim());
      settled = true;
      detachAbort();
      if (signal && signal.aborted) {
        reject(Object.assign(new Error(`${label} cancelled`), { cancelled: true }));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${label} failed${closeSignal ? ` (${closeSignal})` : ''} with exit code ${code}`);
        error.code = code;
        error.signal = closeSignal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

async function executeWithRetry(command, args = [], options = {}) {
  if (!Array.isArray(args)) {
    options = args || {};
    args = [];
  }
  const { maxRetries = 3, label = 'network step', env: extraEnv = {}, logger = noopLogger, ...execOpts } = options;
  const env = { ...process.env, UV_HTTP_TIMEOUT: '600', ...extraEnv };
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await runCommand(command, args, { env, label, logger, ...execOpts });
      return;
    } catch (error) {
      lastError = error;
      if (error && error.cancelled) throw lastError; // user cancelled — don't retry
      if (attempt >= maxRetries || !looksTransient(error)) throw lastError;
      const waitMs = attempt * 4000; // 4s, 8s
      logger.warning(`${label} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      logger.progress(`Transient failure detected. Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }
  throw lastError || new Error(`${label} failed after ${maxRetries} attempts`);
}

const fs = require('fs');

// Shallow-clone a repo at a specific ref (works for a bare commit SHA as well as a tag/branch),
// so engines pin to an exact commit for reproducible installs. The fetch (the network step) retries.
async function shallowCloneAtRef(repoUrl, ref, targetDir, options = {}) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  await runCommand('git', ['init', targetDir], { label: 'git init', ...options });
  await runCommand('git', ['-C', targetDir, 'remote', 'add', 'origin', repoUrl], { label: 'git remote add', ...options });
  await executeWithRetry('git', ['-C', targetDir, 'fetch', '--depth', '1', 'origin', ref], { label: 'git fetch', ...options });
  await runCommand('git', ['-C', targetDir, 'checkout', '--detach', 'FETCH_HEAD'], { label: 'git checkout', ...options });
}

module.exports = {
  sleep, looksTransient, runCommand, executeWithRetry, shallowCloneAtRef, noopLogger, formatCommand,
  setAmbientSignal, clearAmbientSignal,
};
