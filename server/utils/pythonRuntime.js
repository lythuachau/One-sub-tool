const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const venvPath = path.join(projectRoot, '.venv');

const isExecutablePath = (value) => value && path.isAbsolute(value) && fs.existsSync(value);

const resolvePythonExecutable = () => {
  const configured = process.env.NARRATION_PYTHON || process.env.PYTHON_EXECUTABLE;
  const virtualEnvironmentPython = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');

  if (isExecutablePath(configured)) return configured;
  if (isExecutablePath(virtualEnvironmentPython)) return virtualEnvironmentPython;

  return process.platform === 'win32' ? 'python' : 'python3';
};

const pythonExecutable = resolvePythonExecutable();

const formatPythonError = (error) => {
  if (error?.code === 'ENOENT') {
    return `Python runtime not found: ${pythonExecutable}. Set NARRATION_PYTHON or create .venv.`;
  }
  return error?.message || 'Python runtime could not be started';
};

module.exports = {
  projectRoot,
  venvPath,
  pythonExecutable,
  formatPythonError
};
