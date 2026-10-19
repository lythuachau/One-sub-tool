const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { OUTPUT_AUDIO_DIR } = require('../directoryManager');
const { getFfprobePath } = require('../../../services/shared/ffmpegUtils');

const activeWrites = new Map();

const resolveOutputAudioPath = filename => {
  const root = path.resolve(OUTPUT_AUDIO_DIR);
  const resolved = path.resolve(root, String(filename || '').replace(/[\\/]+/g, path.sep));
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid narration filename');
  }
  return resolved;
};

const createSiblingTempPath = targetPath => {
  const extension = path.extname(targetPath) || '.wav';
  const basename = path.basename(targetPath, extension);
  return path.join(path.dirname(targetPath), `.${basename}.${process.pid}.${uuidv4()}.tmp${extension}`);
};

const withAudioFileLock = async (targetPath, operation) => {
  const key = path.resolve(targetPath).toLowerCase();
  const previous = activeWrites.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  activeWrites.set(key, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (activeWrites.get(key) === current) activeWrites.delete(key);
  }
};

const validateWavBuffer = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 46) {
    throw new Error('TTS returned empty or incomplete audio data');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('TTS output is not a valid WAV file');
  }

  let hasFormat = false;
  let hasAudioData = false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new Error('TTS output WAV contains an incomplete chunk');
    if (chunkId === 'fmt ' && chunkSize >= 16) hasFormat = true;
    if (chunkId === 'data' && chunkSize > 0) hasAudioData = true;
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!hasFormat || !hasAudioData) throw new Error('TTS output WAV has no playable audio samples');
};

const validateAudioFile = async filePath => {
  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.size < 46) throw new Error('Audio file is empty or too small');

  const probe = await new Promise((resolve, reject) => {
    const process = spawn(getFfprobePath(), [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type,duration:format=duration',
      '-of', 'json',
      filePath
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handler(value);
    };
    const timeout = setTimeout(() => {
      process.kill();
      finish(reject, new Error('Timed out validating audio file'));
    }, 15000);

    process.stdout.on('data', chunk => { stdout += chunk.toString(); });
    process.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
    process.on('error', error => {
      finish(reject, new Error(`Could not start ffprobe: ${error.message}`));
    });
    process.on('close', code => {
      if (code !== 0) return finish(reject, new Error(stderr.trim() || `ffprobe exited with code ${code}`));
      try {
        finish(resolve, JSON.parse(stdout));
      } catch (error) {
        finish(reject, new Error(`Could not parse ffprobe output: ${error.message}`));
      }
    });
  });

  const stream = probe.streams?.find(item => item.codec_type === 'audio');
  const streamDuration = Number(stream?.duration);
  const formatDuration = Number(probe.format?.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : formatDuration;
  if (!stream || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Audio file has no readable audio stream or duration');
  }
  return { size: stats.size, duration };
};

const writeBufferAtomically = async (targetPath, buffer, validate = async () => {}) => {
  const temporaryPath = createSiblingTempPath(targetPath);
  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: 'wx' });
    await validate(temporaryPath);
    await fs.promises.rename(temporaryPath, targetPath);
    return await fs.promises.stat(targetPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const copyFileAtomically = async (sourcePath, targetPath) => {
  const temporaryPath = createSiblingTempPath(targetPath);
  try {
    await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    await validateAudioFile(temporaryPath);
    await fs.promises.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

module.exports = {
  resolveOutputAudioPath,
  createSiblingTempPath,
  withAudioFileLock,
  validateWavBuffer,
  validateAudioFile,
  writeBufferAtomically,
  copyFileAtomically
};
