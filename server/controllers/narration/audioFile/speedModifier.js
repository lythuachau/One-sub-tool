const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getFfmpegPath } = require('../../../services/shared/ffmpegUtils');
const {
  resolveOutputAudioPath,
  createSiblingTempPath,
  withAudioFileLock,
  validateAudioFile,
  copyFileAtomically
} = require('./audioArtifactSafety');

const parseSpeed = value => {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error('Speed factor must be between 0.5 and 2.0');
  }
  return speed;
};

const resolveAtTempoFilter = speed => speed < 0.5 || speed > 2
  ? `atempo=${Math.sqrt(speed)},atempo=${Math.sqrt(speed)}`
  : `atempo=${speed}`;

const runFfmpeg = args => new Promise((resolve, reject) => {
  const process = spawn(getFfmpegPath(), args, { windowsHide: true });
  let stderr = '';
  process.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  process.on('error', error => reject(new Error(`Could not start FFmpeg: ${error.message}`)));
  process.on('close', code => {
    if (code === 0) return resolve();
    reject(new Error(`FFmpeg exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
  });
});

const getSpeedCodecArgs = audioPath => {
  const extension = path.extname(audioPath).toLowerCase();
  if (extension === '.mp3') return ['-c:a', 'libmp3lame', '-b:a', '192k'];
  if (extension === '.wav') return ['-c:a', 'pcm_s16le', '-ar', '44100'];
  throw new Error(`Unsupported audio format for speed adjustment: ${extension || 'unknown'}`);
};

const getValidSpeedSource = async (audioPath, backupPath) => {
  let backupIsValid = false;
  if (fs.existsSync(backupPath)) {
    try {
      await validateAudioFile(backupPath);
      backupIsValid = true;
    } catch (error) {
      console.warn(`[NarrationSpeed] Invalid backup ${backupPath}: ${error.message}`);
    }
  }

  let audioIsValid = false;
  if (fs.existsSync(audioPath)) {
    try {
      await validateAudioFile(audioPath);
      audioIsValid = true;
    } catch (error) {
      console.warn(`[NarrationSpeed] Invalid source ${audioPath}: ${error.message}`);
    }
  }

  if (backupIsValid) {
    if (!audioIsValid) await copyFileAtomically(backupPath, audioPath);
    return backupPath;
  }
  if (!audioIsValid) throw new Error('Audio file and its backup are both missing or invalid');

  await copyFileAtomically(audioPath, backupPath);
  return backupPath;
};

const processAudioSpeedFile = async (filename, speed) => {
  const audioPath = resolveOutputAudioPath(filename);
  const backupPath = path.join(path.dirname(audioPath), `backup_${path.basename(audioPath)}`);

  return withAudioFileLock(audioPath, async () => {
    if (!fs.existsSync(audioPath) && !fs.existsSync(backupPath)) {
      throw new Error('Audio file not found');
    }

    const sourceFile = await getValidSpeedSource(audioPath, backupPath);
    const temporaryPath = createSiblingTempPath(audioPath);
    try {
      await runFfmpeg([
        '-hide_banner', '-nostdin', '-v', 'error',
        '-i', sourceFile,
        '-map', '0:a:0',
        '-filter:a', resolveAtTempoFilter(speed),
        ...getSpeedCodecArgs(audioPath),
        '-y', temporaryPath
      ]);

      const result = await validateAudioFile(temporaryPath);
      await fs.promises.rename(temporaryPath, audioPath);
      return { filename, size: result.size, duration: result.duration };
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  });
};

const modifyAudioSpeed = async (req, res) => {
  const { filename, speedFactor } = req.body || {};
  if (!filename || speedFactor === undefined || speedFactor === null) {
    return res.status(400).json({ error: 'Missing required parameters (filename, speedFactor)' });
  }

  try {
    const speed = parseSpeed(speedFactor);
    const result = await processAudioSpeedFile(filename, speed);
    return res.json({
      success: true,
      message: `Successfully modified audio speed to ${speed}x`,
      ...result
    });
  } catch (error) {
    console.error(`[NarrationSpeed] ${filename}: ${error.message}`);
    const status = error.message === 'Audio file not found' ? 404 : 422;
    return res.status(status).json({ success: false, error: error.message, filename });
  }
};

const writeEvent = (res, data) => {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const batchModifyAudioSpeed = async (req, res) => {
  const { filenames, speedFactor } = req.body || {};
  if (!Array.isArray(filenames) || filenames.length === 0 || speedFactor === undefined || speedFactor === null) {
    return res.status(400).json({ error: 'Missing required parameters (filenames array, speedFactor)' });
  }

  let speed;
  try {
    speed = parseSpeed(speedFactor);
    filenames.forEach(filename => resolveOutputAudioPath(filename));
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  const uniqueFilenames = [...new Set(filenames.map(String))];
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const results = [];
  const errors = [];
  writeEvent(res, {
    success: true,
    status: 'progress',
    total: uniqueFilenames.length,
    processed: 0,
    message: 'Starting audio speed modification'
  });

  for (const [index, filename] of uniqueFilenames.entries()) {
    try {
      const result = await processAudioSpeedFile(filename, speed);
      results.push(result);
      writeEvent(res, {
        success: true,
        status: 'progress',
        total: uniqueFilenames.length,
        processed: index + 1,
        current: filename,
        message: `Processed ${filename}`
      });
    } catch (error) {
      const itemError = { filename, error: error.message };
      errors.push(itemError);
      console.error(`[NarrationSpeed] ${filename}: ${error.message}`);
      writeEvent(res, {
        success: false,
        status: 'file-error',
        total: uniqueFilenames.length,
        processed: index + 1,
        current: filename,
        ...itemError
      });
    }
  }

  writeEvent(res, {
    success: errors.length === 0,
    status: 'completed',
    total: uniqueFilenames.length,
    processed: uniqueFilenames.length,
    results,
    errors,
    message: errors.length ? 'Audio speed modification completed with errors' : 'Audio speed modification complete'
  });
  return res.end();
};

module.exports = {
  modifyAudioSpeed,
  batchModifyAudioSpeed,
  processAudioSpeedFile
};
