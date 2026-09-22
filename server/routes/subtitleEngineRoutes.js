const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const multer = require('multer');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { VIDEOS_DIR } = require('../config');

const router = express.Router();
const tempDir = path.join(VIDEOS_DIR, '.subtitle-engine');
fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

const runProcess = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`Process timed out after ${options.timeoutMs || 1800000}ms`));
  }, options.timeoutMs || 1800000);
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
  });
});

const getSpeechRegions = async (filePath) => {
  const { stderr } = await runProcess(ffmpegPath, [
    '-hide_banner', '-i', filePath,
    '-af', 'silencedetect=noise=-35dB:d=0.25',
    '-f', 'null', '-'
  ], { timeoutMs: 300000 });
  const silenceStarts = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const silenceEnds = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const regions = [];
  let cursor = 0;
  silenceStarts.forEach((start, index) => {
    if (start > cursor + 0.05) regions.push({ start: cursor, end: start });
    const end = silenceEnds[index];
    cursor = Number.isFinite(end) ? end : start;
  });
  if (duration > cursor + 0.05) regions.push({ start: cursor, end: duration });
  return { regions, duration };
};

const resolveWhisperPython = () => {
  if (process.env.WHISPER_PYTHON) return process.env.WHISPER_PYTHON;
  const sibling = path.resolve(__dirname, '..', '..', '..', 'dich-video', '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(sibling)) return sibling;
  return process.platform === 'win32' ? 'python' : 'python3';
};

router.post('/subtitle-engine/vad', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No media file uploaded' });
  try {
    const result = await getSpeechRegions(req.file.path);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SubtitleEngine] VAD failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

router.post('/subtitle-engine/whisper', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No media file uploaded' });
  const pythonScript = path.join(__dirname, '..', 'whisper_transcribe.py');
  const args = [pythonScript, '--input', req.file.path, '--model', req.body.model || 'medium', '--device', req.body.device || 'auto', '--language', req.body.language || 'auto'];
  try {
    const result = await runProcess(resolveWhisperPython(), args, {
      timeoutMs: Number(process.env.WHISPER_TIMEOUT_MS || 1800000),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    const output = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const payload = JSON.parse(output);
    res.json(payload);
  } catch (error) {
    console.error('[SubtitleEngine] Whisper failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

module.exports = router;
