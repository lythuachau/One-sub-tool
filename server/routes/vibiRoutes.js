const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { NARRATION_DIR } = require('../config');
const { getFfmpegPath } = require('../services/shared/ffmpegUtils');

const router = express.Router();
const VIBI_BASE_URL = (process.env.VIBI_BASE_URL || 'https://api.vibi.pro').replace(/\/$/, '');
const OUTPUT_DIR = path.join(NARRATION_DIR, 'output', 'vibi');
const MAX_TEXT_LENGTH = 5000;
const DEFAULT_MODEL = 'eleven_flash_v2_5';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const getApiKey = (request) => {
  const supplied = request.body?.apiKey || request.query?.apiKey || request.headers['x-vibi-api-key'];
  return String(supplied || process.env.VIBI_API_KEY || '').trim();
};

const redact = (value, apiKey) => String(value || '').replace(apiKey || '__never__', '[redacted]');

const parseResponse = async (response, apiKey) => {
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw: raw.slice(0, 500) };
  }
  if (!response.ok) {
    const message = body?.detail || body?.message || body?.error || body?.raw || `Vibi HTTP ${response.status}`;
    const error = new Error(redact(message, apiKey));
    error.status = response.status;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  return body;
};

const vibiRequest = async (endpoint, apiKey, options = {}) => {
  const response = await fetch(`${VIBI_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      ...(options.headers || {})
    }
  });
  return parseResponse(response, apiKey);
};

const listFromPayload = (payload, key) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const languageCode = (value) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.language_id || value.language_code || value.languageCode || value.code || value.id || '').trim();
};

const languageCodes = (values) => [...new Set((Array.isArray(values) ? values : [values]).map(languageCode).filter(Boolean))];

const normalizeModel = (model) => {
  const languages = languageCodes(model.languages || model.language_codes || model.supported_languages);
  return {
    id: model.model_id || model.modelId || model.id,
    name: model.name || model.display_name || model.model_id || model.id,
    provider: model.provider || 'elevenlabs',
    languages,
    canDoTextToSpeech: model.can_do_text_to_speech !== false,
    supportsSpeed: model.supports_speed !== false
  };
};

const normalizeVoice = (voice) => {
  const languages = languageCodes([
    voice.language,
    voice.language_code,
    voice.languageCode,
    ...(Array.isArray(voice.languages) ? voice.languages : []),
    ...(Array.isArray(voice.verified_languages) ? voice.verified_languages : [])
  ]);
  return {
    id: voice.voice_id || voice.voiceId || voice.id,
    name: voice.name || voice.display_name || voice.voice_id || voice.id,
    language: languages.find(language => language.toLowerCase().startsWith('vi')) || languages[0] || '',
    languages,
    labels: voice.labels || {},
    description: voice.description || '',
    previewUrl: voice.preview_url || voice.previewUrl || '',
    provider: voice.provider || voice.model_provider || 'elevenlabs'
  };
};

const safeSettings = (settings = {}) => ({
  stability: Math.min(1, Math.max(0, Number(settings.stability ?? 0.5))),
  similarity_boost: Math.min(1, Math.max(0, Number(settings.similarityBoost ?? settings.similarity_boost ?? 0.75))),
  style: Math.min(1, Math.max(0, Number(settings.style ?? 0))),
  use_speaker_boost: settings.useSpeakerBoost ?? settings.use_speaker_boost ?? true
});

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAudioUrl = (payload) => payload?.result?.audio_url || payload?.audio_url || payload?.result?.audio || payload?.audio;

const pollHistory = async (id, apiKey) => {
  const deadline = Date.now() + Number(process.env.VIBI_POLL_TIMEOUT_MS || 180000);
  let lastStatus = '';
  while (Date.now() < deadline) {
    const history = await vibiRequest(`/v1/history/${encodeURIComponent(id)}`, apiKey);
    const status = String(history.status || history.result?.status || '').toLowerCase();
    if (status !== lastStatus) lastStatus = status;
    const audioUrl = getAudioUrl(history);
    if (audioUrl && ['completed', 'complete', 'success', 'succeeded', ''].includes(status)) return history;
    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error(history.error || history.message || `Vibi task ${status}`);
    }
    await wait(Number(history.poll_interval_ms || 1000));
  }
  throw new Error('Vibi synthesis timed out while waiting for audio.');
};

const runFfmpeg = (input, output) => new Promise((resolve, reject) => {
  const process = spawn(getFfmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-acodec', 'pcm_s16le', '-ar', '48000', output]);
  let stderr = '';
  process.stderr.on('data', chunk => { stderr += chunk.toString(); });
  process.on('error', reject);
  process.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`)));
});

const synthesize = async ({ apiKey, text, voiceId, modelId, languageCode, voiceSettings, exportTranscript }) => {
  const settings = safeSettings(voiceSettings);
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({ text, voiceId, modelId, languageCode, settings, exportTranscript: !!exportTranscript })).digest('hex');
  const filename = `vibi/${cacheKey}.wav`;
  const outputPath = path.join(NARRATION_DIR, 'output', filename);
  const metadataPath = `${outputPath}.json`;
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 44) {
    return { success: true, filename, cache_hit: true, provider: 'elevenlabs', model_id: modelId, voice_id: voiceId };
  }

  const task = await vibiRequest(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      text,
      provider: 'elevenlabs',
      model_id: modelId || DEFAULT_MODEL,
      language_code: languageCode || 'vi',
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarity_boost,
        style: settings.style,
        use_speaker_boost: settings.use_speaker_boost
      },
      export_transcript: !!exportTranscript
    })
  });
  const taskId = task.id || task.task_id || task.history_item_id;
  const history = taskId ? await pollHistory(taskId, apiKey) : task;
  const audioUrl = getAudioUrl(history);
  if (!audioUrl) throw new Error('Vibi returned no audio URL.');

  const audioResponse = await fetch(audioUrl, { headers: { 'xi-api-key': apiKey } });
  if (!audioResponse.ok) throw new Error(`Vibi audio download failed with HTTP ${audioResponse.status}`);
  const tempDir = path.join(OUTPUT_DIR, 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempMp3 = path.join(tempDir, `${cacheKey}.mp3`);
  const tempWav = path.join(tempDir, `${cacheKey}.wav`);
  fs.writeFileSync(tempMp3, Buffer.from(await audioResponse.arrayBuffer()));
  try {
    await runFfmpeg(tempMp3, tempWav);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.renameSync(tempWav, outputPath);
    fs.writeFileSync(metadataPath, JSON.stringify({ provider: 'elevenlabs', model_id: modelId || DEFAULT_MODEL, voice_id: voiceId, language_code: languageCode || 'vi', voice_settings: settings, content_hash: cacheKey, created_at: new Date().toISOString() }, null, 2));
  } finally {
    for (const file of [tempMp3, tempWav]) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  }
  return { success: true, filename, cache_hit: false, provider: 'elevenlabs', model_id: modelId || DEFAULT_MODEL, voice_id: voiceId };
};

router.get('/catalog', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(400).json({ success: false, error: 'Vibi API key is required.' });
  try {
    const [modelsPayload, voicesPayload] = await Promise.all([
      vibiRequest('/v1/models', apiKey),
      vibiRequest('/v1/shared-voices?required_languages=vi&page_size=100', apiKey)
    ]);
    const models = listFromPayload(modelsPayload, 'models').map(normalizeModel).filter(model => model.id);
    const rawVoices = listFromPayload(voicesPayload, 'voices');
    const voices = (rawVoices.length ? rawVoices : listFromPayload(voicesPayload, 'shared_voices')).map(normalizeVoice).filter(voice => voice.id);
    return res.json({ success: true, models, voices, has_more_voices: !!voicesPayload.has_more });
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, error: redact(error.message, apiKey), retry_after: error.retryAfter || null });
  }
});

router.post('/synthesize', express.json({ limit: '1mb' }), async (req, res) => {
  const apiKey = getApiKey(req);
  const { text, voiceId, modelId = DEFAULT_MODEL, languageCode = 'vi', voiceSettings, exportTranscript = false } = req.body || {};
  if (!apiKey) return res.status(400).json({ success: false, error: 'Vibi API key is required.' });
  if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'Text is required.' });
  if (String(text).length > MAX_TEXT_LENGTH) return res.status(400).json({ success: false, error: `Text must be ${MAX_TEXT_LENGTH} characters or fewer.` });
  if (!String(voiceId || '').trim()) return res.status(400).json({ success: false, error: 'A Vibi voice is required.' });
  try {
    const result = await synthesize({ apiKey, text: String(text).trim(), voiceId: String(voiceId), modelId: String(modelId), languageCode: String(languageCode), voiceSettings, exportTranscript });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, error: redact(error.message, apiKey), retry_after: error.retryAfter || null });
  }
});

module.exports = router;
