const fs = require('fs');
const os = require('os');
const path = require('path');

const pathValue = () => {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
  return pathKey ? process.env[pathKey] || '' : '';
};

const cleanPath = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '');

const isFile = (candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch (error) {
    return false;
  }
};

const candidatePaths = () => {
  const isWindows = process.platform === 'win32';
  const executableName = isWindows ? 'uv.exe' : 'uv';
  const explicit = [process.env.UV_BIN, process.env.UV_EXE]
    .map(cleanPath)
    .filter(Boolean)
    .flatMap((value) => [value, path.join(value, executableName)]);
  const pathEntries = pathValue().split(path.delimiter)
    .map(cleanPath)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const standardWindowsPaths = isWindows ? [
    path.join(home, '.local', 'bin', executableName),
    path.join(localAppData, 'Programs', 'uv', executableName),
    path.join(localAppData, 'Microsoft', 'WinGet', 'Links', executableName),
    path.join(home, 'scoop', 'shims', executableName),
    path.join(home, '.cargo', 'bin', executableName),
  ] : [];

  return [...explicit, ...pathEntries, ...standardWindowsPaths];
};

const resolveUvExecutable = () => {
  const executable = candidatePaths().find(isFile);
  if (executable) return path.resolve(executable);
  throw new Error('uv was not found. Install uv or add its directory to PATH, or set UV_BIN to the full path of uv.exe.');
};

module.exports = { resolveUvExecutable };
