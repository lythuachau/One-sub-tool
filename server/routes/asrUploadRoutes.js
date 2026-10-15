const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { ENGINES } = require('../engines/engineDefs');
const catalog = require('../engines/asrCatalog');
const { probeHealth } = require('../engines/engineStatus');

const router = express.Router();
const uploadDir = path.join(os.tmpdir(), 'one-sub-tool-asr-uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
const chunkSeconds = 180;

const runProcess = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], ...options });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
  });
});

const parseNumber = (value, fallback, min, max) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const proxyChunk = async (serviceUrl, filePath, filename, options) => {
  const bytes = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'audio/wav' }), filename);
  form.set('segment_strategy', options.segmentStrategy);
  form.set('max_chars', String(options.maxChars));
  form.set('max_words', String(options.maxWords));
  form.set('pause_threshold', String(options.pauseThreshold));
  if (options.language) form.set('language', options.language);

  const response = await fetch(`${serviceUrl}/transcribe`, { method: 'POST', body: form });
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); } catch (error) { payload = { detail: responseText }; }
  if (!response.ok) {
    const detail = payload.detail || payload.error || responseText || `HTTP ${response.status}`;
    throw new Error(`${payload.message || detail}`);
  }
  return payload;
};

const transcribeUpload = async (engineId, req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No audio or video file was uploaded.' });
  const removeUploadedFile = () => fs.rmSync(req.file.path, { force: true });
  const engine = ENGINES.find((item) => item.id === engineId);
  if (!engine) {
    removeUploadedFile();
    return res.status(404).json({ success: false, error: `Unknown ASR engine: ${engineId}` });
  }

  let ready = false;
  try {
    ready = await probeHealth(engine);
  } catch (error) {
    removeUploadedFile();
    return res.status(503).json({ success: false, error: `${engine.label} health check failed: ${error.message}` });
  }
  if (!ready) {
    removeUploadedFile();
    return res.status(409).json({
      success: false,
      error: `${engine.label} is not ready. Install the model and start its local service from Settings > Video Processing.`,
    });
  }

  const serviceUrl = `http://127.0.0.1:${engine.port}`;
  const workspace = path.join(os.tmpdir(), `one-sub-tool-asr-${crypto.randomUUID()}`);
  const chunksDirectory = path.join(workspace, 'chunks');

  try {
    fs.mkdirSync(chunksDirectory, { recursive: true });
    await runProcess(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', req.file.path,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      '-f', 'segment', '-segment_time', String(chunkSeconds), '-segment_format', 'wav',
      '-reset_timestamps', '1', path.join(chunksDirectory, 'chunk-%04d.wav'),
    ]);

    const chunks = fs.readdirSync(chunksDirectory)
      .filter((name) => /^chunk-\d+\.wav$/i.test(name))
      .sort();
    if (!chunks.length) throw new Error('FFmpeg did not extract an audio stream from this file.');

    const maxWords = Math.round(parseNumber(req.body.max_words, 7, -1, 50));
    const options = {
      segmentStrategy: ['sentence', 'word', 'char'].includes(req.body.segment_strategy) ? req.body.segment_strategy : 'sentence',
      maxChars: Math.round(parseNumber(req.body.max_chars, 60, 10, 200)),
      maxWords: maxWords === 0 ? 7 : maxWords,
      pauseThreshold: parseNumber(req.body.pause_threshold, 0.8, 0.1, 5),
      language: typeof req.body.language === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/i.test(req.body.language.trim())
        ? req.body.language.trim().slice(0, 2).toLowerCase()
        : undefined,
    };
    const segments = [];
    const transcripts = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const payload = await proxyChunk(
        serviceUrl,
        path.join(chunksDirectory, chunks[index]),
        chunks[index],
        options,
      );
      const offset = index * chunkSeconds;
      if (payload.transcription) transcripts.push(payload.transcription);
      for (const item of payload.segments || []) {
        const start = Number(item.start) || 0;
        const end = Number(item.end) || start;
        const text = String(item.segment || item.text || '').trim();
        if (!text) continue;
        segments.push({ start: start + offset, end: end + offset, text });
      }
    }

    return res.json({
      success: true,
      model: engineId,
      transcription: transcripts.join(' ').trim(),
      duration_seconds: segments.reduce((max, segment) => Math.max(max, segment.end), 0),
      segments,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'ASR transcription failed.' });
  } finally {
    removeUploadedFile();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

router.post('/asr/:engine/transcribe-file', upload.single('file'), (req, res, next) => {
  if (!catalog.isAsrEngine(req.params.engine)) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ success: false, error: `Unknown ASR engine: ${req.params.engine}` });
  }
  return transcribeUpload(req.params.engine, req, res).catch(next);
});

router.post('/parakeet/transcribe-file', upload.single('file'), (req, res, next) => (
  transcribeUpload('parakeet', req, res).catch(next)
));

module.exports = router;
